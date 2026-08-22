import test from 'node:test';
import assert from 'node:assert/strict';
import { StandalonePromotionCoordinator, candidateLifecycleEligible } from './standalone-promotion-coordinator.js';

test('standalone lifecycle accepts only bounded promotion operations and crash points', async () => {
  const coordinator = new StandalonePromotionCoordinator({ pool: { query() { throw new Error('database must not be reached'); } }, routerObserver: async () => true });
  await assert.rejects(coordinator.promote({ mode: 'DELETE' }), /INVALID_STANDALONE_PROMOTION_REQUEST/u);
  await assert.rejects(coordinator.promote({ mode: 'PROMOTE', crashAt: 'ARBITRARY' }), /INVALID_STANDALONE_PROMOTION_REQUEST/u);
});

test('constructor rejects an unstructured router boundary', () => {
  assert.throws(() => new StandalonePromotionCoordinator({ pool: {}, routerObserver: 'curl http://example.invalid' }), /INVALID_STANDALONE/u);
});

test('promotion and hot rollback accept only their exact protected lifecycle states',()=>{
  assert.equal(candidateLifecycleEligible({state:'READY',protection_state:'NONE'},'PROMOTE'),true);
  assert.equal(candidateLifecycleEligible({state:'RETIRING',protection_state:'ROLLBACK'},'ROLLBACK'),true);
  assert.equal(candidateLifecycleEligible({state:'RETIRING',protection_state:'ROLLBACK'},'RESTORE'),true);
  for(const row of [{state:'READY',protection_state:'ROLLBACK'},{state:'RETIRING',protection_state:'NONE'},{state:'SERVING',protection_state:'SERVING'}]){
    assert.equal(candidateLifecycleEligible(row,'PROMOTE'),false);
    assert.equal(candidateLifecycleEligible(row,'ROLLBACK'),false);
    assert.equal(candidateLifecycleEligible(row,'RESTORE'),false);
  }
});
