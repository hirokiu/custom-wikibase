import assert from 'node:assert/strict';
import test from 'node:test';
import { diffCanonicalRdfDatasets } from './rdf-canonicalization.js';
import { datasetToNQuads, partitionWikibaseEntity, partitionWikibaseSnapshot } from './dataset-partition.js';

const base = 'http://127.0.0.1:8180';
const snapshot = [
  `<${base}/entity/Q1> <http://schema.org/version> "10" .`,
  `<${base}/entity/Q1> <${base}/prop/P1> <${base}/entity/statement/Q1-s1> .`,
  `<${base}/entity/statement/Q1-s1> <${base}/prop/statement/P1> "old" .`,
  `<${base}/entity/P1> <http://schema.org/version> "7" .`,
  `<${base}/entity/P1> <http://wikiba.se/ontology#directClaim> <${base}/prop/direct/P1> .`,
  `<${base}/prop/direct/P1> <http://www.w3.org/2002/07/owl#propertyChainAxiom> _:schema .`,
  `_:schema <http://www.w3.org/1999/02/22-rdf-syntax-ns#first> <${base}/prop/P1> .`,
  '<http://wikiba.se/ontology#Dump> <http://schema.org/softwareVersion> "1" .',
].join('\n') + '\n';

test('snapshot uses named entity, per-Property schema and global graphs with no duplicate triples', () => {
  const dataset = partitionWikibaseSnapshot(snapshot);
  assert.deepEqual([...dataset.graphs.keys()], ['urn:jwb:entity:P1', 'urn:jwb:schema:P1', 'urn:jwb:entity:Q1', 'urn:jwb:global']);
  assert.match(dataset.graphs.get('urn:jwb:entity:Q1'), /statement\/Q1-s1/u);
  assert.match(dataset.graphs.get('urn:jwb:schema:P1'), /propertyChainAxiom/u);
  assert.match(dataset.graphs.get('urn:jwb:global'), /softwareVersion/u);
  const all = [...dataset.graphs.values()].flatMap((value) => value.trim().split('\n').filter(Boolean));
  assert.equal(all.length, new Set(all).size);
  assert.equal(all.length, snapshot.trim().split('\n').length);
});

test('full snapshot and entity-by-entity/property/global processing are dataset-equivalent', () => {
  const full = partitionWikibaseSnapshot(snapshot);
  const incrementalGraphs = new Map();
  for (const entityId of ['Q1', 'P1']) {
    const value = partitionWikibaseEntity({ entityId, rdf: snapshot });
    incrementalGraphs.set(value.entityGraphIri, value.entityRdf);
    if (value.schemaGraphIri) incrementalGraphs.set(value.schemaGraphIri, value.schemaRdf);
  }
  incrementalGraphs.set('urn:jwb:global', full.graphs.get('urn:jwb:global'));
  assert.deepEqual(diffCanonicalRdfDatasets(datasetToNQuads(full), datasetToNQuads({ graphs: incrementalGraphs })), { canonicalOnly: [], generationOnly: [] });
});
