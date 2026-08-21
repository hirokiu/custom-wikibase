import assert from 'node:assert/strict';
import test from 'node:test';
import { GenerationDatasetLoader } from './generation-dataset-loader.js';

test('snapshot loader clears default dataset and writes only registered named partitions', async () => {
  const calls = [], graphs = [];
  const backend = { resetToken: () => 'reset:x', async reset(value) { calls.push(['reset', value]); }, async replaceNamedGraph(value) { calls.push(['replace', value.graphIri]); } };
  const repository = { async registerGraph(value) { graphs.push(value); }, async saveEntity(value) { calls.push(['fence', value.entityId, value.indexedRevision]); }, async setSchemaState(value) { calls.push(['schema', value]); } };
  const rdf = '<http://x/entity/Q1> <http://www.w3.org/2000/01/rdf-schema#label> "Q1" .\n<http://x/wiki/Special:EntityData/Q1> <http://schema.org/version> "1"^^<http://www.w3.org/2001/XMLSchema#integer> .\n<http://x/global> <http://x/p> "g" .\n';
  const result = await new GenerationDatasetLoader({ backend, repository }).loadSnapshot({ rdf });
  assert.deepEqual(calls, [['reset', { confirmationToken: 'reset:x' }], ['replace', 'urn:jwb:entity:Q1'], ['fence', 'Q1', 1], ['replace', 'urn:jwb:global'], ['schema', 'CURRENT']]);
  assert.deepEqual(graphs.map((value) => value.graphIri), ['urn:jwb:entity:Q1', 'urn:jwb:global']);
  assert.equal(result.partitionModel, 'jwb-partition-v1');
});
