import assert from 'node:assert/strict';
import test from 'node:test';
import { SparqlHttpBackend } from './sparql-http-backend.js';
import { RDF_BACKEND_PROFILES } from './profiles.js';

test('keeps query and update endpoint security descriptors distinct', () => {
  const backend = new SparqlHttpBackend({
    metadata: RDF_BACKEND_PROFILES['fuseki-tdb2'], queryUrl: 'http://127.0.0.1:3030/jwb/query',
    updateUrl: 'http://127.0.0.1:3030/jwb/update', graphStoreUrl: 'http://127.0.0.1:3030/jwb/data'
  });
  assert.equal(backend.sparqlQueryEndpoint().access, 'public-read');
  assert.equal(backend.internalUpdateEndpoint().access, 'internal-write');
});

test('rejects credentials embedded in endpoint URLs', () => {
  assert.throws(() => new SparqlHttpBackend({ metadata: RDF_BACKEND_PROFILES.oxigraph, queryUrl: 'http://user:secret@localhost/query' }), /invalid RDF endpoint/u);
});

test('fails closed when a declared capability is absent', async () => {
  const backend = new SparqlHttpBackend({
    metadata: RDF_BACKEND_PROFILES['blazegraph-wdqs'], queryUrl: 'http://127.0.0.1:9999/sparql',
    updateUrl: 'http://127.0.0.1:9999/sparql'
  });
  await assert.rejects(() => backend.replaceNamedGraph({ graphIri: 'urn:test', source: '/tmp/no', mediaType: 'application/n-triples' }), /graphStoreProtocol/u);
});
