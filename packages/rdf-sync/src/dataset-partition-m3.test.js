import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { diffCanonicalRdfDatasets } from './rdf-canonicalization.js';
import { datasetToNQuads, partitionWikibaseEntity, partitionWikibaseSnapshot } from './dataset-partition.js';

test('controlled M3/M4 evidence partitions identically through snapshot and entity paths', () => {
  const rdf = readFileSync(new URL('../test-fixtures/m3-baseline.nt', import.meta.url), 'utf8');
  const full = partitionWikibaseSnapshot(rdf);
  const incremental = new Map();
  for (const graphIri of full.graphs.keys()) {
    const entityId = graphIri.match(/^urn:jwb:entity:([QP][1-9][0-9]*)$/u)?.[1];
    if (!entityId) continue;
    const value = partitionWikibaseEntity({ entityId, rdf });
    incremental.set(value.entityGraphIri, value.entityRdf);
    if (value.schemaGraphIri) incremental.set(value.schemaGraphIri, value.schemaRdf);
  }
  incremental.set('urn:jwb:global', full.graphs.get('urn:jwb:global'));
  const difference = diffCanonicalRdfDatasets(datasetToNQuads(full), datasetToNQuads({ graphs: incremental }));
  assert.deepEqual(difference, { canonicalOnly: [], generationOnly: [] });
  assert.equal(full.graphs.has(''), false, 'default graph is never authoritative');
  assert.ok([...full.graphs.keys()].filter((value) => value.startsWith('urn:jwb:schema:P')).length >= 7);
});
