import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWikibaseRdf } from './canonical-rdf-normalizer.js';
import { partitionWikibaseEntity, partitionWikibaseSnapshot } from './dataset-partition.js';
import { diffCanonicalRdfGraphs } from './rdf-canonicalization.js';

const base = 'http://127.0.0.1:8280';
const semantic = [
  `<${base}/entity/Q1> <http://www.w3.org/2000/01/rdf-schema#label> "同一 revision"@ja .`,
  `<${base}/wiki/Special:EntityData/Q1> <http://schema.org/about> <${base}/entity/Q1> .`,
  `<${base}/wiki/Special:EntityData/Q1> <http://schema.org/version> "6"^^<http://www.w3.org/2001/XMLSchema#integer> .`,
  `<${base}/entity/Q1> <${base}/prop/P1> <${base}/entity/statement/Q1-s1> .`,
  `<${base}/entity/statement/Q1-s1> <${base}/prop/qualifier/P7> "qualified" .`,
  `<${base}/entity/statement/Q1-s1> <http://www.w3.org/ns/prov#wasDerivedFrom> <${base}/reference/r1> .`,
  `<${base}/reference/r1> <${base}/prop/reference/P8> <https://example.invalid/source> .`,
  `<${base}/entity/Q1> <${base}/prop/P5> <${base}/entity/statement/Q1-s2> .`,
  `<${base}/entity/statement/Q1-s2> <${base}/prop/statement/value/P5> <${base}/value/v1> .`,
  `<${base}/value/v1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://wikiba.se/ontology#QuantityValue> .`,
  `<${base}/value/v1> <http://wikiba.se/ontology#quantityAmount> "42"^^<http://www.w3.org/2001/XMLSchema#decimal> .`,
].join('\n') + '\n';

test('FULL_DUMP and EntityData project the same complex Q1 revision into the authoritative entity graph', () => {
  const full = normalizeWikibaseRdf(`<http://wikiba.se/ontology#Dump> <http://schema.org/dateModified> "2026-08-20T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .\n${semantic}`, { sourceKind: 'FULL_DUMP' });
  const entity = normalizeWikibaseRdf(`<${base}/wiki/Special:EntityData/Q1> <http://creativecommons.org/ns#license> <http://creativecommons.org/publicdomain/zero/1.0/> .\n${semantic}`, { sourceKind: 'ENTITY_DATA' });
  const snapshot = partitionWikibaseSnapshot(full.rdf).graphs.get('urn:jwb:entity:Q1');
  const incremental = partitionWikibaseEntity({ entityId: 'Q1', rdf: entity.rdf }).entityRdf;
  assert.deepEqual(diffCanonicalRdfGraphs(snapshot, incremental), { canonicalOnly: [], generationOnly: [] });
  assert.match(snapshot, /schema\.org\/version> "6"/u);
  assert.match(snapshot, /QuantityValue/u);
  assert.match(snapshot, /prop\/qualifier/u);
  assert.match(snapshot, /prop\/reference/u);
});
