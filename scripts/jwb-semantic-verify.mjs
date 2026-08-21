#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { validateSemanticFixtureManifest } from '../packages/rdf-sync/src/semantic-fixture-manifest.js';

const manifest = validateSemanticFixtureManifest(JSON.parse(readFileSync('/tmp/japan-wikibase-semantic-fixture.json', 'utf8')));
const apiBase = 'http://127.0.0.1:8280';
const sparqlEndpoint = 'http://127.0.0.1:8290/sparql';
const entity = `http://127.0.0.1:8280/entity/${manifest.subjectItem}`;
const target = `http://127.0.0.1:8280/entity/${manifest.targetItem}`;
const graph = `urn:jwb:entity:${manifest.subjectItem}`;
const propertyGraph = `urn:jwb:schema:${manifest.properties.string}`;

const response = await fetch(`${apiBase}/api.php?${new URLSearchParams({
  action: 'wbgetentities', ids: manifest.subjectItem, props: 'labels|descriptions|aliases|claims',
  format: 'json', formatversion: '2',
})}`);
if (!response.ok) throw new Error(`JWB_SEMANTIC_API_HTTP_${response.status}`);
const value = (await response.json()).entities?.[manifest.subjectItem];
if (!value || value.labels?.ja?.value !== '意味試験項目' || value.labels?.en?.value !== 'Semantic fixture item'
  || value.descriptions?.ja?.value !== '有界意味試験' || value.descriptions?.en?.value !== 'Bounded semantic qualification'
  || !value.aliases?.ja?.some(({ value: alias }) => alias === '意味fixture')
  || !value.aliases?.en?.some(({ value: alias }) => alias === 'semantic fixture')) fail('terms');
for (const property of [manifest.properties.string, manifest.properties.externalId, manifest.properties.item,
  manifest.properties.quantity, manifest.properties.time]) if (!value.claims?.[property]?.length) fail(`claim-${property}`);
const statement = value.claims[manifest.properties.string][0];
if (!statement.qualifiers?.[manifest.properties.qualifier]?.length
  || !statement.references?.[0]?.snaks?.[manifest.properties.reference]?.length) fail('qualifier-reference');

const checks = {
  labelsDescriptionsAliases: `GRAPH <${graph}> { <${entity}> ?p ?v . FILTER(STR(?v) IN ("Semantic fixture item", "Bounded semantic qualification", "semantic fixture")) }`,
  string: `GRAPH <${graph}> { ?s ?p "${manifest.expected.string}" }`,
  externalId: `GRAPH <${graph}> { ?s ?p "${manifest.expected.externalId}" }`,
  itemValue: `GRAPH <${graph}> { ?s ?p <${target}> }`,
  quantity: `GRAPH <${graph}> { ?s ?p ?v . FILTER(STR(?v) = "42" || STR(?v) = "+42") }`,
  time: `GRAPH <${graph}> { ?s ?p ?v . FILTER(CONTAINS(STR(?v), "2026-08-20T00:00:00")) }`,
  qualifier: `GRAPH <${graph}> { ?s ?p "${manifest.expected.qualifier}" }`,
  reference: `GRAPH <${graph}> { ?s ?p <${manifest.expected.reference}> }`,
  propertySchema: `GRAPH <${propertyGraph}> { ?s ?p ?o }`,
};
for (const [name, body] of Object.entries(checks)) if (!await ask(body)) fail(name);
process.stdout.write(`${JSON.stringify({ fixture: manifest.fixtureType, subjectItem: manifest.subjectItem,
  api: 'PASS', sparql: Object.fromEntries(Object.keys(checks).map(key => [key, 'PASS'])) }, null, 2)}\n`);

async function ask(body) {
  const response = await fetch(sparqlEndpoint, { method: 'POST', headers: {
    'content-type': 'application/sparql-query', accept: 'application/sparql-results+json',
  }, body: `ASK { ${body} }` });
  if (!response.ok) throw new Error(`JWB_SEMANTIC_SPARQL_HTTP_${response.status}`);
  return (await response.json()).boolean === true;
}
function fail(category) { throw new Error(`JWB_SEMANTIC_VERIFY_FAILED:${category}`); }
