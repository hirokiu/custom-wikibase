#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SparqlHttpBackend } from '../services/rdf-backends/src/sparql-http-backend.js';
import { RDF_BACKEND_PROFILES } from '../services/rdf-backends/src/profiles.js';
import { JWB_DOCKER_CONTEXT, assertJwbDockerTarget } from './jwb-lib.mjs';
import { RDF_MANIFEST_FILE, RDF_SNAPSHOT_FILE, commonQueries } from './jwb-rdf-lib.mjs';

const backendName = process.argv.find((arg) => arg.startsWith('--backend='))?.slice('--backend='.length);
if (!['fuseki-tdb2', 'oxigraph', 'virtuoso', 'blazegraph-wdqs'].includes(backendName)) throw new Error('use --backend=fuseki-tdb2|oxigraph|virtuoso|blazegraph-wdqs');
assertLocalDocker();
if (!existsSync(RDF_SNAPSHOT_FILE) || !existsSync(RDF_MANIFEST_FILE)) throw new Error('run npm run jwb:rdf:dump first');

if (backendName === 'blazegraph-wdqs') {
  const result = { backend: backendName, status: 'skipped', reason: 'architecture_unavailable', architecture: 'arm64', compatibilityPath: 'existing Stage B AMD64 harness' };
  persistResult(result); console.log(JSON.stringify(result, null, 2)); process.exit(0);
}

const config = backendConfig(backendName);
const environment = { ...process.env, DOCKER_CONTEXT: JWB_DOCKER_CONTEXT, JWB_RDF_ADMIN_PASSWORD: randomBytes(32).toString('base64url') };
const started = performance.now();
let result;
try {
  phase('compose_up');
  compose(config, ['up', '--detach', '--build'], environment);
  const backend = new SparqlHttpBackend({ ...config.endpoints(environment), metadata: RDF_BACKEND_PROFILES[backendName] });
  phase('wait_healthy_initial');
  await waitHealthy(backend, 180_000);
  const startupMs = Math.round(performance.now() - started);
  await backend.initialize({ instanceId: `m2-${backendName}` });
  const loadStarted = performance.now();
  phase('load_snapshot');
  await backend.loadSnapshot({ source: RDF_SNAPSHOT_FILE, mediaType: 'application/n-triples' });
  const loadMs = Math.round(performance.now() - loadStarted);
  phase('assert_queries_initial');
  await assertQueries(backend);

  const restartStarted = performance.now();
  phase('restart');
  compose(config, ['restart', 'rdf-backend'], environment);
  phase('wait_healthy_restart');
  await waitHealthy(backend, 180_000);
  const restartMs = Math.round(performance.now() - restartStarted);
  await assertQueries(backend);

  const updateFile = `/tmp/wfp-jwb-m2-${backendName}-update.nt`;
  writePrivate(updateFile, '<urn:jwb:m2:subject> <urn:jwb:m2:predicate> "incremental" .\n');
  phase('replace_named_graph');
  await backend.replaceNamedGraph({ graphIri: 'urn:jwb:m2:update', source: updateFile, mediaType: 'application/n-triples' });
  await assertAsk(backend, 'ASK { GRAPH <urn:jwb:m2:update> { <urn:jwb:m2:subject> <urn:jwb:m2:predicate> "incremental" } }', 'named graph update');

  const exportFile = `/tmp/wfp-jwb-m2-${backendName}-export.nt`;
  phase('export');
  const exported = await backend.exportDataset({ destination: exportFile, mediaType: 'application/n-triples' });
  phase('rebuild');
  await backend.rebuild({ snapshot: { source: RDF_SNAPSHOT_FILE, mediaType: 'application/n-triples' } });
  await assertQueries(backend);
  phase('reset');
  await backend.reset({ confirmationToken: backend.resetToken() });
  const empty = await backend.query('ASK { ?s ?p ?o }');
  if (empty.boolean !== false) throw new Error('reset did not clear the dataset');

  const containerId = capture('docker', composeArgs(config, ['ps', '--quiet', 'rdf-backend']), environment).trim();
  const imageId = capture('docker', ['inspect', '--format', '{{.Image}}', containerId], environment).trim();
  result = {
    backend: backendName, status: 'passed', measuredAt: new Date().toISOString(), startupMs, loadMs, restartMs,
    imageBytes: Number(capture('docker', ['image', 'inspect', '--format', '{{.Size}}', imageId], environment).trim()),
    runtime: JSON.parse(capture('docker', ['stats', '--no-stream', '--format', '{{json .}}', containerId], environment).trim()),
    persistedVolumeBytes: null, persistedVolumeMeasurement: 'unavailable_on_docker_desktop_without_privileged_volume_access',
    exported
  };
  await backend.shutdown();
} finally {
  phase('compose_down');
  compose(config, ['down', '--volumes', '--remove-orphans'], environment);
}
persistResult(result);
console.log(JSON.stringify(result, null, 2));

async function assertQueries(backend) {
  for (const [name, query] of Object.entries(commonQueries(JSON.parse(readFileSync(RDF_MANIFEST_FILE, 'utf8'))))) await assertAsk(backend, query, name);
}
async function assertAsk(backend, query, name) { const value = await backend.query(query); if (value.boolean !== true) throw new Error(`common SPARQL assertion failed: ${name}`); }
async function waitHealthy(backend, timeout) {
  const deadline = Date.now() + timeout;
  // A timer before the first fetch keeps Node alive while a just-started Virtuoso has not bound 8890 yet.
  while (Date.now() < deadline) { await new Promise((resolve) => setTimeout(resolve, 250)); if ((await backend.health()).status === 'healthy') return; }
  throw new Error(`backend did not become healthy within ${timeout} ms`);
}

function backendConfig(name) {
  const root = new URL('../infrastructure/japan-wikibase/rdf/', import.meta.url).pathname;
  const key = name === 'fuseki-tdb2' ? 'fuseki' : name;
  const port = { 'fuseki-tdb2': 13030, oxigraph: 17878, virtuoso: 18890 }[name];
  return {
    project: `wfp-jwb-rdf-${key}`, file: `${root}compose.rdf-${key}.yaml`, directory: root,
    endpoints(env) {
      if (name === 'fuseki-tdb2') return { queryUrl: `http://127.0.0.1:${port}/jwb/query`, updateUrl: `http://127.0.0.1:${port}/jwb/update`, graphStoreUrl: `http://127.0.0.1:${port}/jwb/data` };
      if (name === 'oxigraph') return { queryUrl: `http://127.0.0.1:${port}/query`, updateUrl: `http://127.0.0.1:${port}/update`, graphStoreUrl: `http://127.0.0.1:${port}/store` };
      return {
        queryUrl: `http://127.0.0.1:${port}/sparql?default-graph-uri=${encodeURIComponent('urn:jwb:m2:dataset')}`,
        updateUrl: `http://127.0.0.1:${port}/sparql-auth`, datasetGraphIri: 'urn:jwb:m2:dataset',
        graphStoreUrl: `http://127.0.0.1:${port}/sparql-graph-crud-auth`, digestAuth: { username: 'dba', password: env.JWB_RDF_ADMIN_PASSWORD }
      };
    }
  };
}
function compose(config, args, env) { execFileSync('docker', composeArgs(config, args), { cwd: config.directory, env, stdio: 'inherit' }); }
function composeArgs(config, args) { return ['compose', '--project-name', config.project, '--file', config.file, ...args]; }
function capture(command, args, env = process.env) { return execFileSync(command, args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }); }
function assertLocalDocker() { const context = capture('docker', ['context', 'show']).trim(); const [os, architecture] = capture('docker', ['info', '--format', '{{.OperatingSystem}}\n{{.Architecture}}']).trim().split('\n'); assertJwbDockerTarget({ context, operatingSystem: os.includes('Docker Desktop') ? 'linux' : os.toLowerCase(), architecture }); }
function persistResult(value) { writePrivate(`/tmp/wfp-jwb-m2-${backendName}-result.json`, `${JSON.stringify(value, null, 2)}\n`); }
function writePrivate(path, body) { writeFileSync(path, body, { mode: 0o600 }); chmodSync(path, 0o600); }
function phase(value) { if (process.env.JWB_M2_TRACE === '1') process.stderr.write(`m2-phase:${backendName}:${value}\n`); }
