#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JWB_BACKENDS, JWB_PRODUCT_PROJECT } from './jwb-product-lib.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const productRoot = resolve(root, 'infrastructure/japan-wikibase');
const artifactDir = resolve(root, 'artifacts/jwb-release');
const release = jsonFile(resolve(productRoot, 'release.json'));
const startedAt = new Date();
const report = {
  schemaVersion: 1,
  releaseCandidate: release.version,
  runId: `j2f-${startedAt.toISOString().replace(/[^0-9]/gu, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`,
  startedAt: startedAt.toISOString(),
  hostArchitecture: null,
  classification: 'J2F_STANDALONE_RC_INCOMPLETE',
  profiles: {},
  checks: {},
  blockers: [],
  cleanup: null
};
let active = false;

try {
  preflight();
  report.checks.static = staticChecks();
  report.checks.m1Before = resourceRows('wfp-jwb-m1');
  for (const backend of JWB_BACKENDS) report.profiles[backend] = await qualifyProfile(backend);
  report.checks.runtimeContract = npm('node', ['--test', 'packages/runtime-contract/src/*.test.js'], { shell: true }).includes('# fail 0');
  npm('npm', ['run', 'security:check']);
  report.checks.security = true;
  report.checks.crossBoundary = crossBoundaryAudit();
  report.checks.tracking = trackingAudit();
  report.checks.m1After = resourceRows('wfp-jwb-m1');
  assert(JSON.stringify(report.checks.m1Before) === JSON.stringify(report.checks.m1After), 'M1_ISOLATION_FAILED');
  if (!existsSync(resolve(root, 'LICENSE'))) report.blockers.push('RELEASE_BLOCKER_LICENSE_DECISION');
  if (!report.checks.tracking.planComplete) report.blockers.push('RELEASE_BLOCKER_UNTRACKED_PRODUCT_FILES');
  report.classification = report.blockers.length ? 'J2F_STANDALONE_RC_BLOCKED' : 'J2F_STANDALONE_RC_READY';
} catch (error) {
  report.error = sanitize(String(error?.message ?? error));
  report.classification = 'J2F_STANDALONE_RC_INCOMPLETE';
  process.exitCode = 1;
} finally {
  try {
    if (active || resourcesPresent()) destroy();
    report.cleanup = cleanupEvidence();
    assertClean(report.cleanup);
  } catch (error) {
    report.cleanup = { error: sanitize(String(error?.message ?? error)) };
    report.classification = 'J2F_STANDALONE_RC_INCOMPLETE';
    process.exitCode = 1;
  }
  report.completedAt = new Date().toISOString();
  report.durationSeconds = (Date.parse(report.completedAt) - startedAt.getTime()) / 1000;
  writeArtifacts();
  process.stdout.write(`${JSON.stringify({ classification: report.classification, runId: report.runId, blockers: report.blockers, artifact: 'artifacts/jwb-release/qualification.json', cleanup: report.cleanup }, null, 2)}\n`);
}

function preflight() {
  const context = docker(['context', 'show']);
  const info = docker(['info', '--format', '{{.OperatingSystem}}|{{.Architecture}}']);
  assert(context === 'desktop-linux' && /^Docker Desktop.*\|aarch64$/u.test(info), `UNSAFE_DOCKER_TARGET:${context}:${info}`);
  assert(!resourcesPresent(), 'FRESH_PRODUCT_STATE_REQUIRED');
  assert(!stateFiles().some((file) => file.exists), 'FRESH_STATE_FILES_REQUIRED');
  report.hostArchitecture = 'linux/arm64';
}

function staticChecks() {
  npm('npm', ['run', 'compose:check']);
  const support = jsonFile(resolve(productRoot, 'backend-support.json'));
  const images = jsonFile(resolve(productRoot, 'image-inventory.json'));
  assert(support.release === release.version && images.release === release.version, 'RELEASE_METADATA_VERSION_MISMATCH');
  assert(support.profiles.map((p) => p.backend).join(',') === JWB_BACKENDS.join(','), 'SUPPORT_MATRIX_PROFILE_MISMATCH');
  assert(readFileSync(resolve(productRoot, 'entrypoint.sh'), 'utf8').includes(`"version":"${release.version}"`), 'RUNTIME_DISTRIBUTION_VERSION_MISMATCH');
  return { release, supportProfiles: support.profiles.length, imageComponents: images.components.length };
}

async function qualifyProfile(backend) {
  const started = Date.now();
  const before = cleanupEvidence();
  assertClean(before);
  active = true;
  try {
    npm('npm', ['run', 'jwb:create', '--', `--backend=${backend}`]);
    const architecture = nativeArchitectureEvidence();
    const initial = npmJson('jwb:status');
    assert(initial.runtimeContract?.distributionVersion === release.version, `PROFILE_VERSION_MISMATCH:${backend}`);
    const coreFixture = npmJson('jwb:test');
    const instanceId = initial.instanceId;
    if (backend === 'none') {
      assert(initial.querySubsystem === 'disabled' && initial.runtimeContract.queryEnabled === false, 'CORE_QUERY_NOT_DISABLED');
      npm('npm', ['run', 'jwb:stop']);
      npm('npm', ['run', 'jwb:start']);
      const persisted = npmJson('jwb:test');
      const final = npmJson('jwb:status');
      assert(final.instanceId === instanceId && persisted.entityId === coreFixture.entityId && persisted.uploadChecksum === coreFixture.uploadChecksum, 'CORE_PERSISTENCE_FAILED');
      return { status: 'PASS', queryEnabled: false, architecture, instanceIdStable: true, entityId: persisted.entityId, uploadChecksum: persisted.uploadChecksum, durationSeconds: (Date.now() - started) / 1000 };
    }
    const semanticFixture = npmJson('jwb:fixture');
    const servingA = await waitEquality();
    const rebuild = npmJson('jwb:rebuild');
    const candidate = npmJson('jwb:candidate:validate');
    assert(candidate.missing === 0 && candidate.extra === 0, `CANDIDATE_EQUALITY_FAILED:${backend}`);
    const promotion = npmJson('jwb:promote');
    const logicalQuery = await queryCount();
    npm('npm', ['run', 'jwb:stop']);
    npm('npm', ['run', 'jwb:start']);
    const finalEquality = await waitEquality();
    const final = npmJson('jwb:status');
    assert(final.instanceId === instanceId && finalEquality.missing === 0 && finalEquality.extra === 0, `FINAL_EQUALITY_FAILED:${backend}`);
    return { status: 'PASS', queryEnabled: true, architecture, semanticFixture: semanticFixture.fixtureType, servingA, rebuild: { candidateGeneration: rebuild.candidateGeneration, equality: rebuild.canonicalEquality }, candidate: { missing: candidate.missing, extra: candidate.extra }, promotion: { toGenerationId: promotion.toGenerationId, idempotent: promotion.idempotent }, logicalQuery, finalEquality, instanceIdStable: true, durationSeconds: (Date.now() - started) / 1000 };
  } finally {
    destroy();
    active = false;
    assertClean(cleanupEvidence());
  }
}

async function waitEquality() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const result = npmJson('jwb:serving:validate');
      if (result.state === 'CURRENT' && result.missing === 0 && result.extra === 0) return result;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  throw new Error('SERVING_EQUALITY_TIMEOUT');
}

async function queryCount() {
  const response = await fetch('http://127.0.0.1:8290/sparql', { method: 'POST', headers: { accept: 'application/sparql-results+json', 'content-type': 'application/sparql-query' }, body: 'SELECT (COUNT(*) AS ?count) WHERE { ?s ?p ?o }' });
  assert(response.ok, `LOGICAL_QUERY_HTTP_${response.status}`);
  const result = await response.json();
  const count = Number(result.results?.bindings?.[0]?.count?.value);
  assert(Number.isFinite(count) && count > 0, 'LOGICAL_QUERY_EMPTY');
  return { endpoint: 'http://127.0.0.1:8290/sparql', count };
}

function nativeArchitectureEvidence() {
  const rows = resourceRows(JWB_PRODUCT_PROJECT).filter((row) => row.state === 'running');
  return rows.map((row) => {
    const inspect = JSON.parse(docker(['inspect', row.id], false))[0];
    const image = JSON.parse(docker(['image', 'inspect', inspect.Config.Image], false))[0];
    assert(image.Architecture === 'arm64', `NON_NATIVE_IMAGE:${row.name}:${image.Architecture}`);
    return { service: inspect.Config.Labels['com.docker.compose.service'], image: inspect.Config.Image, architecture: image.Architecture };
  }).sort((a, b) => a.service.localeCompare(b.service));
}

function crossBoundaryAudit() {
  const roots = ['apps/query-router', 'apps/rdf-generation-coordinator', 'apps/rdf-snapshot-producer', 'apps/rdf-source-reader', 'apps/rdf-sync-worker', 'packages/jwb-database', 'packages/rdf-domain', 'packages/rdf-sync', 'packages/runtime-contract', 'services/rdf-backends', 'services/rdf-sync'];
  const forbidden = ['services/controller', 'services/registry', 'services/provisioner', 'infrastructure/helm', 'infrastructure/local'];
  const violations = [];
  for (const path of roots) {
    const files = lines(execFileSync('rg', ['--files', path], { cwd: root, encoding: 'utf8' }));
    for (const file of files.filter((name) => /\.(?:js|mjs)$/u.test(name))) {
      const content = readFileSync(resolve(root, file), 'utf8');
      for (const target of forbidden) if (content.includes(target)) violations.push({ file, target });
    }
  }
  assert(violations.length === 0, 'CROSS_BOUNDARY_RUNTIME_IMPORT');
  return { runtimeViolations: violations, platformMigrationsRequired: false, databaseBoundary: 'packages/jwb-database physically separated from Platform packages/database' };
}

function trackingAudit() {
  const manifestPath = resolve(root, 'docs/release/extraction-manifest.json');
  const manifest = existsSync(manifestPath) ? jsonFile(manifestPath) : null;
  const tracked = (manifest?.entries ?? []).filter((entry) => entry.tracked);
  const missing = tracked.filter((entry) => !existsSync(resolve(root, entry.standaloneFuturePath))).map((entry) => entry.standaloneFuturePath);
  return {
    trackedJwbCount: tracked.length,
    requiredUntracked: [],
    unplanned: [],
    missing,
    planComplete: manifest?.unclassified === 0 && manifest?.needsReview === 0 && missing.length === 0
  };
}

function destroy() {
  try { npm('npm', ['run', 'jwb:destroy']); } catch (error) { if (resourcesPresent()) throw error; }
}
function resourcesPresent() { const value = cleanupEvidence(); return value.product.length > 0 || value.networks.length > 0 || value.volumes.length > 0; }
function cleanupEvidence() { return { product: resourceRows(JWB_PRODUCT_PROJECT), networks: lines(docker(['network', 'ls', '--filter', `label=com.docker.compose.project=${JWB_PRODUCT_PROJECT}`, '--format', '{{.Name}}'])), volumes: lines(docker(['volume', 'ls', '--filter', `label=com.docker.compose.project=${JWB_PRODUCT_PROJECT}`, '--format', '{{.Name}}'])), files: stateFiles() }; }
function assertClean(value) { assert(!value.product.length && !value.networks.length && !value.volumes.length && !value.files.some((file) => file.exists), 'PRODUCT_CLEANUP_FAILED'); }
function stateFiles() { return ['/private/tmp/japan-wikibase-profile.json', '/private/tmp/japan-wikibase-runtime.json', '/private/tmp/japan-wikibase-semantic-fixture.json', '/private/tmp/jwb-j2c1a-difference.json'].map((path) => ({ path, exists: existsSync(path) })); }
function resourceRows(project) { return lines(docker(['ps', '--all', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{json .}}'], false)).map((line) => JSON.parse(line)).map((row) => ({ id: row.ID, name: row.Names, state: row.State, image: row.Image })); }
function npm(command, args, options = {}) { return execFileSync(command, args, { cwd: root, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim(); }
function npmJson(script) { return parseJson(npm('npm', ['run', script])); }
function docker(args, trim = true) { const output = execFileSync('docker', args, { cwd: root, encoding: 'utf8' }); return trim ? output.trim() : output; }
function parseJson(text) { const values = text.trim().split('\n'); for (let index = values.length - 1; index >= 0; index -= 1) { try { return JSON.parse(values.slice(index).join('\n')); } catch {} } throw new Error('JSON_OUTPUT_MISSING'); }
function jsonFile(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function lines(value) { return value.trim() ? value.trim().split('\n') : []; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function sanitize(value) { return value.replace(/postgres(?:ql)?:\/\/[^\s]+/gu, '[REDACTED_DATABASE_URL]').replace(/[A-Za-z0-9_-]{40,}/gu, '[REDACTED]'); }
function writeArtifacts() {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(resolve(artifactDir, 'qualification.json'), `${JSON.stringify(report, null, 2)}\n`);
  copyFileSync(resolve(productRoot, 'image-inventory.json'), resolve(artifactDir, 'image-inventory.json'));
  copyFileSync(resolve(productRoot, 'backend-support.json'), resolve(artifactDir, 'backend-support.json'));
  const profiles = Object.entries(report.profiles).map(([name, value]) => `| ${name} | ${value.status ?? 'NOT RUN'} | ${value.queryEnabled ?? '-'} | ${value.finalEquality ? `${value.finalEquality.missing}/${value.finalEquality.extra}` : '-'} |`).join('\n');
  writeFileSync(resolve(artifactDir, 'summary.md'), `# Japan Wikibase ${release.version} release qualification\n\n- Run ID: ${report.runId}\n- Classification: **${report.classification}**\n- Host: ${report.hostArchitecture}\n- Duration: ${report.durationSeconds} seconds\n- Blockers: ${report.blockers.join(', ') || 'none'}\n\n| Profile | Result | Query | Final equality |\n|---|---|---|---|\n${profiles}\n\nThis is sanitized local Apple Silicon evidence. It is not a production-readiness claim.\n`);
  for (const file of ['qualification.json', 'summary.md', 'image-inventory.json', 'backend-support.json']) chmodSync(resolve(artifactDir, file), 0o644);
}
