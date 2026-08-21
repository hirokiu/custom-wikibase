import test from 'node:test';
import assert from 'node:assert/strict';
import { StandalonePromotionCoordinator } from './standalone-promotion-coordinator.js';

test('standalone lifecycle accepts only bounded promotion operations and crash points', async () => {
  const coordinator = new StandalonePromotionCoordinator({ pool: { query() { throw new Error('database must not be reached'); } }, routerObserver: async () => true });
  await assert.rejects(coordinator.promote({ mode: 'DELETE' }), /INVALID_STANDALONE_PROMOTION_REQUEST/u);
  await assert.rejects(coordinator.promote({ mode: 'PROMOTE', crashAt: 'ARBITRARY' }), /INVALID_STANDALONE_PROMOTION_REQUEST/u);
});

test('constructor rejects an unstructured router boundary', () => {
  assert.throws(() => new StandalonePromotionCoordinator({ pool: {}, routerObserver: 'curl http://example.invalid' }), /INVALID_STANDALONE/u);
});
