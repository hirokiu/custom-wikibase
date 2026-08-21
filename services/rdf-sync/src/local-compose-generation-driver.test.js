import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalComposeGenerationDriver } from './local-compose-generation-driver.js';

test('physical driver derives fixed local names, ports and argument arrays', async () => {
  const calls = [];
  const driver = new LocalComposeGenerationDriver({ backendType: 'virtuoso', execFile: async (...args) => { calls.push(args); } });
  const value = await driver.createGeneration({ generationId: 'gen-a' });
  assert.equal(value.queryUrl, 'http://127.0.0.1:19190/sparql');
  assert.deepEqual(calls[0][1].slice(0, 4), ['compose', '--project-name', 'wfp-jwb-m9-virtuoso-gen-a', '--file']);
  await driver.deleteGeneration({ generationId: 'gen-a' });
  assert.deepEqual(calls[1][1].slice(-3), ['down', '--volumes', '--remove-orphans']);
});

test('physical driver rejects caller-selected IDs, backend types and contexts', () => {
  assert.throws(() => new LocalComposeGenerationDriver({ backendType: 'unknown' }), /unsupported/u);
  assert.throws(() => new LocalComposeGenerationDriver({ backendType: 'virtuoso', dockerContext: 'utirik' }), /Docker Desktop/u);
  const driver = new LocalComposeGenerationDriver({ backendType: 'oxigraph', execFile: async () => {} });
  assert.throws(() => driver.descriptor('gen-user-chosen'), /not allocated/u);
  assert.throws(() => driver.descriptor('gen-a;rm'), /invalid/u);
});
