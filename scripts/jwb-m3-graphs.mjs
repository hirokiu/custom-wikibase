#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SparqlHttpBackend } from '../services/rdf-backends/src/sparql-http-backend.js';
import { RDF_BACKEND_PROFILES } from '../services/rdf-backends/src/profiles.js';
import { JWB_DOCKER_CONTEXT, assertJwbDockerTarget } from './jwb-lib.mjs';
import { canonicalizeNTriples, diffNTriples, entityClosure, summarizeDiff } from './jwb-m3-lib.mjs';

const backendName = process.argv.find((arg) => arg.startsWith('--backend='))?.slice(10);
if (!['fuseki-tdb2', 'virtuoso', 'oxigraph'].includes(backendName)) throw new Error('use --backend=fuseki-tdb2|virtuoso|oxigraph');
assertLocalDocker();
const artifacts = new URL('../artifacts/jwb-m3/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(`${artifacts}entity-manifest.json`, 'utf8'));
const finalSnapshot = `${artifacts}K-external-id.nt`;
if (!existsSync(finalSnapshot)) throw new Error('run npm run jwb:rdf:m3:capture first');
const config = backendConfig(backendName);
const env = { ...process.env, DOCKER_CONTEXT: JWB_DOCKER_CONTEXT, JWB_RDF_ADMIN_PASSWORD: randomBytes(32).toString('base64url') };
let result;
try {
  compose(config, ['up', '--detach', '--build'], env);
  const backend = new SparqlHttpBackend({ ...config.endpoints(env), metadata: RDF_BACKEND_PROFILES[backendName] });
  await waitHealthy(backend);
  await backend.initialize({ instanceId: `m3-${backendName}` });
  for (const id of manifest.entities) await backend.replaceNamedGraph({ graphIri: `urn:jwb:entity:${id}`, source: `${artifacts}entity-${id}.nt`, mediaType: 'application/n-triples' });
  await backend.replaceNamedGraph({ graphIri: `urn:jwb:entity:${manifest.q1}`, source: `${artifacts}entity-K-external-id-${manifest.q1}.nt`, mediaType: 'application/n-triples' });
  const union = canonicalizeNTriples(await constructAll(config.endpoints(env).queryUrl));
  const unionDynamic = stripEntitySerializationMetadata(entityClosure(union, manifest.entities));
  const expected = stripEntitySerializationMetadata(entityClosure(readFileSync(finalSnapshot, 'utf8'), manifest.entities));
  const difference = diffNTriples(expected, unionDynamic);
  writeText(`graph-${backendName}-full-only.nt`, difference.removed.join('\n') + (difference.removed.length ? '\n' : ''));
  writeText(`graph-${backendName}-union-only.nt`, difference.added.join('\n') + (difference.added.length ? '\n' : ''));
  const rebuildStarted = performance.now();
  await backend.rebuild({ snapshot: { source: finalSnapshot, mediaType: 'application/n-triples' } });
  const rebuildMs = Math.round(performance.now() - rebuildStarted);
  const health = await backend.health();
  result = { backend: backendName, graphReplacement: { equal: difference.added.length === 0 && difference.removed.length === 0, ...summarizeDiff(difference), ignoredGlobalOrSchemaTriples: Math.max(0, union.trim().split('\n').filter(Boolean).length - unionDynamic.trim().split('\n').filter(Boolean).length) }, rebuildMs, health: health.status };
  writeText(`graph-${backendName}-result.json`, `${JSON.stringify(result, null, 2)}\n`);
} finally {
  compose(config, ['down', '--volumes', '--remove-orphans'], env);
}
console.log(JSON.stringify(result, null, 2));

async function constructAll(queryUrl) {
  const response = await fetch(queryUrl, { method: 'POST', headers: { accept: 'application/n-triples', 'content-type': 'application/sparql-query' }, body: 'CONSTRUCT { ?s ?p ?o } WHERE { GRAPH ?g { ?s ?p ?o } }' });
  if (!response.ok) throw new Error(`union export HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.text();
}
async function waitHealthy(backend) { const deadline = Date.now() + 180_000; while (Date.now() < deadline) { if ((await backend.health()).status === 'healthy') return; await new Promise((resolve) => setTimeout(resolve, 1000)); } throw new Error('backend health timeout'); }
function backendConfig(name) { const root = new URL('../infrastructure/japan-wikibase/rdf/', import.meta.url).pathname; const key = name === 'fuseki-tdb2' ? 'fuseki' : name; const port = { 'fuseki-tdb2': 13030, oxigraph: 17878, virtuoso: 18890 }[name]; return { project: `wfp-jwb-rdf-${key}`, file: `${root}compose.rdf-${key}.yaml`, directory: root, endpoints(env) { if (name === 'fuseki-tdb2') return { queryUrl: `http://127.0.0.1:${port}/jwb/query`, updateUrl: `http://127.0.0.1:${port}/jwb/update`, graphStoreUrl: `http://127.0.0.1:${port}/jwb/data` }; if (name === 'oxigraph') return { queryUrl: `http://127.0.0.1:${port}/query`, updateUrl: `http://127.0.0.1:${port}/update`, graphStoreUrl: `http://127.0.0.1:${port}/store` }; return { queryUrl: `http://127.0.0.1:${port}/sparql?default-graph-uri=${encodeURIComponent('urn:jwb:m3:dataset')}`, updateUrl: `http://127.0.0.1:${port}/sparql-auth`, graphStoreUrl: `http://127.0.0.1:${port}/sparql-graph-crud-auth`, datasetGraphIri: 'urn:jwb:m3:dataset', digestAuth: { username: 'dba', password: env.JWB_RDF_ADMIN_PASSWORD } }; } }; }
function compose(config, args, env) { execFileSync('docker', ['compose', '--project-name', config.project, '--file', config.file, ...args], { cwd: config.directory, env, stdio: 'inherit' }); }
function writeText(name, body) { const path = `${artifacts}${name}`; writeFileSync(path, body, { mode: 0o600 }); chmodSync(path, 0o600); }
function stripEntitySerializationMetadata(value) { return value.split('\n').filter((line) => !line.includes('creativecommons.org/ns#license') && !line.includes('schema.org/softwareVersion')).join('\n'); }
function assertLocalDocker() { const context = execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim(); const [os, architecture] = execFileSync('docker', ['info', '--format', '{{.OperatingSystem}}\n{{.Architecture}}'], { encoding: 'utf8' }).trim().split('\n'); assertJwbDockerTarget({ context, operatingSystem: os.includes('Docker Desktop') ? 'linux' : os.toLowerCase(), architecture }); }
