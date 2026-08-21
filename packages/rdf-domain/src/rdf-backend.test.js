import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RDF_BACKEND_CAPABILITY_NAMES,
  RdfBackend,
  validateRdfBackendMetadata
} from './rdf-backend.js';

function allCapabilities(value = false) {
  return Object.fromEntries(RDF_BACKEND_CAPABILITY_NAMES.map((name) => [name, value]));
}

test('validates and freezes complete RDF backend metadata', () => {
  const metadata = validateRdfBackendMetadata({
    backendType: 'virtuoso',
    capabilities: { ...allCapabilities(false), sparql11Query: true, namedGraphs: true }
  });

  assert.equal(metadata.backendType, 'virtuoso');
  assert.equal(metadata.capabilities.sparql11Query, true);
  assert.equal(Object.isFrozen(metadata), true);
  assert.equal(Object.isFrozen(metadata.capabilities), true);
});

test('rejects unknown, missing, and non-boolean capabilities', () => {
  assert.throws(
    () => validateRdfBackendMetadata({ backendType: 'unknown', capabilities: allCapabilities() }),
    /type is not supported/
  );
  assert.throws(
    () => validateRdfBackendMetadata({ backendType: 'fuseki-tdb2', capabilities: {} }),
    /missing RDF backend capabilities/
  );
  assert.throws(
    () => validateRdfBackendMetadata({
      backendType: 'oxigraph',
      capabilities: { ...allCapabilities(), vendorExtension: true }
    }),
    /unknown RDF backend capabilities/
  );
  assert.throws(
    () => validateRdfBackendMetadata({
      backendType: 'qlever',
      capabilities: { ...allCapabilities(), geoSparql: 'partial' }
    }),
    /must be boolean/
  );
});

test('base contract fails closed for unimplemented operations', async () => {
  const backend = new RdfBackend();
  assert.throws(() => backend.metadata(), /not implemented/);
  assert.throws(() => backend.sparqlQueryEndpoint(), /not implemented/);
  await assert.rejects(backend.health(), /not implemented/);
  await assert.rejects(backend.reset({ confirmationToken: 'test-only' }), /not implemented/);
  await assert.rejects(backend.createGeneration({ generationId: 'g-1', sourceSnapshotCursor: {} }), /not implemented/);
  await assert.rejects(backend.getServingGeneration(), /not implemented/);
  await assert.rejects(backend.promoteGeneration({ generationId: 'g-1', expectedServingGenerationId: null }), /not implemented/);
  await assert.rejects(backend.rollbackPromotion({ promotionId: 'p-1' }), /not implemented/);
});
