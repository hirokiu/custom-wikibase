#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QueryRouter } from '../apps/query-router/src/router.js';
import { RouterMetrics } from '../apps/query-router/src/metrics.js';
import { diffCanonicalRdfDatasets } from '../packages/rdf-sync/src/rdf-canonicalization.js';
import { normalizeWikibaseRdf } from '../packages/rdf-sync/src/canonical-rdf-normalizer.js';
import { datasetToNQuads, partitionWikibaseSnapshot } from '../packages/rdf-sync/src/dataset-partition.js';
import { GenerationDatasetLoader } from '../services/rdf-sync/src/generation-dataset-loader.js';
import { LocalComposeGenerationDriver } from '../services/rdf-sync/src/local-compose-generation-driver.js';
import { JWB_DOCKER_CONTEXT, assertJwbDockerTarget } from './jwb-lib.mjs';
import { execFileSync } from 'node:child_process';

const backendType = process.argv.find((value) => value.startsWith('--backend='))?.slice(10);
if (!['virtuoso', 'oxigraph', 'fuseki-tdb2'].includes(backendType)) throw new Error('allowlisted backend required');
assertLocal();
const driver = new LocalComposeGenerationDriver({ backendType });
const rdf = readFileSync(new URL('../artifacts/jwb-m3/baseline.nt', import.meta.url), 'utf8');
const expected = partitionWikibaseSnapshot(normalizeWikibaseRdf(rdf,{sourceKind:'FULL_DUMP'}).rdf);
const graphIris = [];
let result;
try {
  const physical = await driver.createGeneration({ generationId: 'gen-a' });
  const backend = driver.backend('gen-a'); await healthy(backend); await backend.initialize({ instanceId: `m9a-${backendType}` });
  const repository = { async registerGraph(value) { graphIris.push(value.graphIri); }, async saveEntity() {}, async setSchemaState() {} };
  await new GenerationDatasetLoader({ backend, repository }).loadSnapshot({ rdf });
  const pointer = { async get() { return { generationId: 'gen-a', version: 1, graphIris: [...graphIris].sort() }; } };
  const router = new QueryRouter({ pointerRepository: pointer, targetRegistry: [['gen-a', physical]], metrics: new RouterMetrics() });
  const response = await router.query('ASK { ?s ?p ?o }');
  assert.equal(JSON.parse(new TextDecoder().decode(response.body)).boolean, true, 'logical union query is empty');
  for(const query of semanticQueries())assert.equal(JSON.parse(new TextDecoder().decode((await router.query(query)).body)).boolean,true,`semantic query failed: ${query}`);
  const defaultResult = await askExplicitDefault(physical.queryUrl, 'urn:jwb:default'); assert.equal(defaultResult, false, 'managed empty default graph must remain empty');
  const observed = await exportDataset(physical.queryUrl, graphIris);
  const difference = diffCanonicalRdfDatasets(datasetToNQuads(expected), observed);
  assert.deepEqual(difference, { canonicalOnly: [], generationOnly: [] });
  result = { backendType, status: 'passed', graphCount: graphIris.length, defaultGraphEmpty: true, logicalUnionVisible: true, canonicalOnly: 0, generationOnly: 0 };
} finally { await driver.deleteGeneration({ generationId: 'gen-a' }); }
console.log(JSON.stringify(result, null, 2));

async function exportDataset(queryUrl, graphs) { const lines = []; for (const graphIri of graphs) { const response = await fetch(queryUrl, { method: 'POST', headers: { accept: 'application/n-triples', 'content-type': 'application/sparql-query' }, body: `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${graphIri}> { ?s ?p ?o } }` }); if (!response.ok) throw new Error(`named graph export HTTP ${response.status}`); for (const line of (await response.text()).trim().split('\n').filter(Boolean)) lines.push(`${line.slice(0, -1).trimEnd()} <${graphIri}> .`); } return lines.sort().join('\n') + '\n'; }
async function askExplicitDefault(queryUrl, graphIri) { const url = new URL(queryUrl); url.searchParams.append('default-graph-uri', graphIri); const response = await fetch(url, { method: 'POST', headers: { accept: 'application/sparql-results+json', 'content-type': 'application/sparql-query' }, body: 'ASK { ?s ?p ?o }' }); if (!response.ok) throw new Error(`default graph query HTTP ${response.status}`); return (await response.json()).boolean; }
async function healthy(backend) { const deadline = Date.now() + 180000; while (Date.now() < deadline) { await new Promise((resolve) => setTimeout(resolve, 250)); if ((await backend.health()).status === 'healthy') return; } throw new Error('backend health timeout'); }
function capture(command, args) { return execFileSync(command, args, { encoding: 'utf8', env: { ...process.env, DOCKER_CONTEXT: JWB_DOCKER_CONTEXT } }).trim(); }
function assertLocal() { const context = capture('docker', ['context', 'show']); const [os, architecture] = capture('docker', ['info', '--format', '{{.OperatingSystem}}\n{{.Architecture}}']).split('\n'); assertJwbDockerTarget({ context, operatingSystem: os.includes('Docker Desktop') ? 'linux' : os.toLowerCase(), architecture }); }
function semanticQueries(){const base='http://127.0.0.1:8180';return[`ASK { <${base}/entity/Q3> a <http://wikiba.se/ontology#Item> }`,`ASK { <${base}/entity/P1> a <http://wikiba.se/ontology#Property> }`,`ASK { ?statement <${base}/prop/qualifier/P6> ?value }`,`ASK { ?reference <${base}/prop/reference/P7> ?value }`,`ASK { ?value a <http://wikiba.se/ontology#QuantityValue> }`,`ASK { ?value a <http://wikiba.se/ontology#TimeValue> }`,`ASK { ?entity <http://www.w3.org/2000/01/rdf-schema#label> ?label }`,`ASK { <${base}/entity/P1> <http://wikiba.se/ontology#propertyType> ?type }`];}
