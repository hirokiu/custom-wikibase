#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { QueryRouter } from '../apps/query-router/src/router.js';
import { RouterMetrics } from '../apps/query-router/src/metrics.js';
import { SparqlHttpBackend } from '../services/rdf-backends/src/sparql-http-backend.js';
import { RDF_BACKEND_PROFILES } from '../services/rdf-backends/src/profiles.js';
import { canonicalizeNTriples, diffNTriples } from './jwb-m3-lib.mjs';
import { JWB_BASE_URL, JWB_DOCKER_CONTEXT, JWB_PROJECT, JWB_STATE_FILE, assertJwbDockerTarget, stateEnvironment } from './jwb-lib.mjs';
import { RDF_MANIFEST_FILE } from './jwb-rdf-lib.mjs';

class Pointer {
  constructor() { this.value = { generationId: 'gen-a', previousGenerationId: null, version: 1 }; }
  async get() { return { ...this.value }; }
  cas({ expectedVersion, expectedGenerationId, generationId }) {
    if (this.value.version !== expectedVersion || this.value.generationId !== expectedGenerationId) throw new Error('SERVING_POINTER_CONFLICT');
    this.value = { generationId, previousGenerationId: this.value.generationId, version: expectedVersion + 1 };
  }
}

const allowed = ['virtuoso', 'oxigraph', 'fuseki-tdb2'];
const sourceType = option('--backend=');
const candidateType = option('--candidate=') ?? sourceType;
if (!allowed.includes(sourceType) || !allowed.includes(candidateType)) throw new Error('allowlisted --backend and --candidate are required');
assertLocal();
const state = JSON.parse(readFileSync(JWB_STATE_FILE, 'utf8'));
const manifest = JSON.parse(readFileSync(RDF_MANIFEST_FILE, 'utf8'));
stateEnvironment(state);
const a = physical(sourceType, 'a');
const b = physical(candidateType, 'b');
const pointer = new Pointer();
const files = [];
let output;

try {
  const c0 = dump('c0');
  files.push(c0.path);
  up(a); up(b);
  await healthy(a.backend); await healthy(b.backend);
  await a.backend.initialize({ instanceId: `m8-${a.key}-a` });
  await b.backend.initialize({ instanceId: `m8-${b.key}-b` });
  const bootstrapStarted = performance.now();
  await a.backend.rebuild({ snapshot: { source: c0.path, mediaType: 'application/n-triples' } });
  const equalityA = await equality(a, c0, 'a'); files.push(equalityA.exportPath);
  requireEqual(equalityA);
  const router = new QueryRouter({ pointerRepository: pointer, targetRegistry: [['gen-a', target(a)], ['gen-b', target(b)]], metrics: new RouterMetrics() });
  const duringCandidate = [];
  for (let index = 0; index < 20; index += 1) duringCandidate.push(classify(await router.query('ASK { ?s ?p ?o }')));
  const snapshotLoad = b.backend.rebuild({ snapshot: { source: c0.path, mediaType: 'application/n-triples' } });
  const edits = await realEdits(state, manifest);
  await snapshotLoad;
  const afterC0 = [];
  for (let index = 0; index < 20; index += 1) afterC0.push(classify(await router.query('ASK { ?s ?p ?o }')));
  const c1 = dump('c1'); files.push(c1.path);
  const catchupStarted = performance.now();
  await b.backend.rebuild({ snapshot: { source: c1.path, mediaType: 'application/n-triples' } });
  const catchupMs = Math.round(performance.now() - catchupStarted);
  const equalityB = await equality(b, c1, 'b'); files.push(equalityB.exportPath);
  requireEqual(equalityB);
  const before = await queries(router, 50);
  const promotedAt = performance.now();
  pointer.cas({ expectedVersion: 1, expectedGenerationId: 'gen-a', generationId: 'gen-b' });
  const promotionMs = performance.now() - promotedAt;
  const after = await queries(router, 50);
  restart(b); await healthy(b.backend);
  const afterCandidateRestart = await queries(router, 20);
  pointer.cas({ expectedVersion: 2, expectedGenerationId: 'gen-b', generationId: 'gen-a' });
  const rollback = await queries(router, 30);
  const resources = [stats(a), stats(b)];
  output = {
    sourceBackend: sourceType, candidateBackend: candidateType, status: 'passed_partial_qualification',
    realSource: true, edits, bootstrapMs: Math.round(performance.now() - bootstrapStarted), catchupMs,
    canonical: { c0Triples: c0.triples, c1Triples: c1.triples, generationA: equalityA.summary, generationB: equalityB.summary },
    visibility: { duringCandidate: summarize(duringCandidate), afterC0: summarize(afterC0), before: summarize(before), after: summarize(after), afterCandidateRestart: summarize(afterCandidateRestart), rollback: summarize(rollback) },
    promotionMs: Number(promotionMs.toFixed(3)), rollbackFreshness: 'stale-but-complete-at-c0', resources,
    limitations: ['catch-up used canonical C1 replacement, not RecentChanges replay', 'no durable PostgreSQL worker in this harness', 'no 30-minute soak', 'no A-K physical crash matrix'],
  };
} finally {
  down(b); down(a);
  for (const file of files) try { unlinkSync(file); } catch {}
}
console.log(JSON.stringify(output, null, 2));

async function realEdits(localState, fixture) {
  const session = await login(localState);
  const suffix = Date.now().toString(36);
  const subject = await post(session, { action: 'wbsetlabel', id: fixture.subjectItem, language: 'ja', value: `M8 再構築 ${suffix}`, summary: 'M8 active edit' });
  const property = await post(session, { action: 'wbsetlabel', id: fixture.properties.string, language: 'en', value: `M8 string ${suffix}`, summary: 'M8 property/schema mutation' });
  const entity = await get({ action: 'wbgetentities', ids: fixture.subjectItem, props: 'claims' }, session.cookie);
  const claim = entity.entities?.[fixture.subjectItem]?.claims?.[fixture.properties.string]?.[0]?.id;
  if (!claim) throw new Error('M8 string claim is unavailable');
  const statement = await post(session, { action: 'wbsetclaimvalue', claim, snaktype: 'value', value: JSON.stringify(`M8 value ${suffix}`), summary: 'M8 statement mutation' });
  const title = `Item:${fixture.relatedItem}`;
  const deleted = await post(session, { action: 'delete', title, reason: 'M8 rebuild delete cycle' });
  const undeleted = await post(session, { action: 'undelete', title, reason: 'M8 rebuild undelete cycle' });
  return { subjectRevision: revision(subject), propertyRevision: revision(property), statementRevision: revision(statement), deleteLogId: deleted.logid ?? null, undeleteRevision: undeleted.pageinfo?.lastrevid ?? null, propertySchemaMutated: true, deleteUndelete: true };
}

function dump(label) {
  const path = `/tmp/wfp-jwb-m8-${sourceType}-${candidateType}-${label}.nt`;
  const env = { ...process.env, DOCKER_CONTEXT: JWB_DOCKER_CONTEXT, ...stateEnvironment(state) };
  const body = execFileSync('docker', ['compose', '--project-name', JWB_PROJECT, '--file', new URL('../infrastructure/japan-wikibase/compose.yaml', import.meta.url).pathname, 'exec', '--no-TTY', 'wikibase', 'php', 'extensions/Wikibase/repo/maintenance/dumpRdf.php', '--format', 'n-triples'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  writeFileSync(path, body, { mode: 0o600 }); chmodSync(path, 0o600);
  return { path, triples: canonicalizeNTriples(body).trim().split('\n').filter(Boolean).length, body };
}
async function equality(value, canonical, suffix) {
  const exportPath = `/tmp/wfp-jwb-m8-${value.key}-${suffix}-export.nt`;
  await value.backend.exportDataset({ destination: exportPath, mediaType: 'application/n-triples' });
  const exported = readFileSync(exportPath, 'utf8');
  const canonicalNormalized = equalityProjection(canonical.body);
  const generationNormalized = equalityProjection(exported);
  const difference = diffNTriples(canonicalNormalized.comparable, generationNormalized.comparable);
  return { exportPath, summary: { canonicalTriples: canonicalizeNTriples(canonical.body).trim().split('\n').filter(Boolean).length, generationTriples: canonicalizeNTriples(exported).trim().split('\n').filter(Boolean).length, ignoredCanonicalBlankNodeLines: canonicalNormalized.ignored, ignoredGenerationBlankNodeLines: generationNormalized.ignored, fullOnly: difference.removed.length, generationOnly: difference.added.length }, samples: { fullOnly: difference.removed.slice(0, 3), generationOnly: difference.added.slice(0, 3) } };
}
function requireEqual(value) { assert.equal(value.summary.fullOnly, 0, `canonical triples missing from generation: ${JSON.stringify(value.samples)}`); assert.equal(value.summary.generationOnly, 0, `generation has non-canonical triples: ${JSON.stringify(value.samples)}`); }
function equalityProjection(body) { const lines = canonicalizeNTriples(body).trim().split('\n').filter(Boolean); const comparable = lines.filter((line) => !line.includes('_:')).join('\n') + '\n'; return { comparable, ignored: lines.length - comparable.trim().split('\n').filter(Boolean).length }; }
async function queries(router, count) { const values = []; for (let index = 0; index < count; index += 1) { try { values.push(classify(await router.query('ASK { ?s ?p ?o }'))); } catch { values.push('CONNECTION_ERROR'); } } return values; }
function classify(value) { return value.generationId === 'gen-a' ? 'OLD_COMPLETE' : value.generationId === 'gen-b' ? 'NEW_COMPLETE' : 'INVALID'; }
function summarize(values) { return Object.fromEntries([...new Set(values)].map((key) => [key, values.filter((value) => value === key).length])); }

function physical(type, suffix) {
  const key = type === 'fuseki-tdb2' ? 'fuseki' : type;
  const ports = { fuseki: [13230, 13231], virtuoso: [19090, 19091], oxigraph: [18078, 18079] }[key];
  const port = ports[suffix === 'a' ? 0 : 1];
  const password = randomBytes(32).toString('base64url');
  const env = { ...process.env, DOCKER_CONTEXT: JWB_DOCKER_CONTEXT, JWB_RDF_HOST_PORT: String(port), JWB_RDF_ADMIN_PASSWORD: password };
  const root = new URL('../infrastructure/japan-wikibase/rdf/', import.meta.url).pathname;
  const base = `http://127.0.0.1:${port}`;
  const endpoints = type === 'fuseki-tdb2' ? { queryUrl: `${base}/jwb/query`, updateUrl: `${base}/jwb/update`, graphStoreUrl: `${base}/jwb/data` } : type === 'oxigraph' ? { queryUrl: `${base}/query`, updateUrl: `${base}/update`, graphStoreUrl: `${base}/store` } : { queryUrl: `${base}/sparql?default-graph-uri=${encodeURIComponent('urn:jwb:m8:dataset')}`, updateUrl: `${base}/sparql-auth`, graphStoreUrl: `${base}/sparql-graph-crud-auth`, datasetGraphIri: 'urn:jwb:m8:dataset', digestAuth: { username: 'dba', password } };
  return { type, key, suffix, port, env, project: `wfp-jwb-m8-${key}-gen-${suffix}`, file: `${root}compose.rdf-${key}.yaml`, root, queryUrl: endpoints.queryUrl, backend: new SparqlHttpBackend({ ...endpoints, metadata: RDF_BACKEND_PROFILES[type] }) };
}
function target(value) { return { queryUrl: value.queryUrl, healthUrl: value.queryUrl }; }
function up(value) { execFileSync('docker', ['compose', '--project-name', value.project, '--file', value.file, 'up', '--detach', '--build'], { cwd: value.root, env: value.env, stdio: 'inherit' }); }
function down(value) { try { execFileSync('docker', ['compose', '--project-name', value.project, '--file', value.file, 'down', '--volumes', '--remove-orphans'], { cwd: value.root, env: value.env, stdio: 'inherit' }); } catch {} }
function restart(value) { execFileSync('docker', ['compose', '--project-name', value.project, '--file', value.file, 'restart', 'rdf-backend'], { cwd: value.root, env: value.env, stdio: 'inherit' }); }
async function healthy(backend) { const deadline = Date.now() + 180000; while (Date.now() < deadline) { await new Promise((resolve) => setTimeout(resolve, 250)); if ((await backend.health()).status === 'healthy') return; } throw new Error('backend health timeout'); }
function stats(value) { const id = capture('docker', ['ps', '--filter', `label=com.docker.compose.project=${value.project}`, '--format', '{{.ID}}']); return { backend: value.type, ...JSON.parse(capture('docker', ['stats', '--no-stream', '--format', '{{json .}}', id])) }; }

async function login(localState) { let value = await request({ action: 'query', meta: 'tokens', type: 'login' }); value = await request({ action: 'login', lgname: localState.adminUser, lgpassword: localState.adminPassword, lgtoken: value.data.query.tokens.logintoken }, value.cookie, true); if (value.data.login?.result !== 'Success') throw new Error('M8 login failed'); const csrf = await request({ action: 'query', meta: 'tokens' }, value.cookie); return { cookie: csrf.cookie, token: csrf.data.query.tokens.csrftoken }; }
async function get(parameters, cookie = '') { return (await request(parameters, cookie)).data; }
async function post(session, parameters) { const value = await request({ ...parameters, token: session.token }, session.cookie, true); if (value.data.error) throw new Error(`MediaWiki operation failed: ${value.data.error.code}`); session.cookie = value.cookie; return value.data; }
async function request(parameters, cookie = '', postRequest = false) { const values = { format: 'json', formatversion: '2', ...parameters }; const response = postRequest ? await fetch(`${JWB_BASE_URL}/api.php`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: new URLSearchParams(values) }) : await fetch(`${JWB_BASE_URL}/api.php?${new URLSearchParams(values)}`, { headers: cookie ? { cookie } : {} }); if (!response.ok) throw new Error(`MediaWiki HTTP ${response.status}`); const cookies = new Map(cookie.split('; ').filter(Boolean).map((value) => [value.split('=', 1)[0], value])); for (const value of response.headers.getSetCookie?.() ?? []) { const pair = value.split(';', 1)[0]; cookies.set(pair.split('=', 1)[0], pair); } return { data: await response.json(), cookie: [...cookies.values()].join('; ') }; }
function revision(value) { return value.entity?.lastrevid ?? value.pageinfo?.lastrevid ?? value.claim?.lastrevid ?? null; }
function option(prefix) { return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length); }
function capture(command, args) { return execFileSync(command, args, { encoding: 'utf8', env: { ...process.env, DOCKER_CONTEXT: JWB_DOCKER_CONTEXT } }).trim(); }
function assertLocal() { const context = capture('docker', ['context', 'show']); const [os, architecture] = capture('docker', ['info', '--format', '{{.OperatingSystem}}\n{{.Architecture}}']).split('\n'); assertJwbDockerTarget({ context, operatingSystem: os.includes('Docker Desktop') ? 'linux' : os.toLowerCase(), architecture }); }
