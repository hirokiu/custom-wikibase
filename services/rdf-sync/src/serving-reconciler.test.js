import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileServingEvidence, selectGenerationCleanupCandidates } from './serving-reconciler.js';

const pointer = { generationId: 'gen-b', previousGenerationId: 'gen-a', version: 2 };
const generations = [{ generationId: 'gen-a', state: 'RETIRING' }, { generationId: 'gen-b', state: 'SERVING' }];

test('startup reconciliation requires pointer, registry and backend health agreement', () => {
  assert.deepEqual(reconcileServingEvidence({ pointer, generations, promotions: [], healthByGeneration: new Map([['gen-b', 'healthy']]) }), { classification: 'CONSISTENT', ready: true, relatedGenerationIds: [] });
  assert.equal(reconcileServingEvidence({ pointer, generations, promotions: [], healthByGeneration: new Map([['gen-b', 'unhealthy']]) }).classification, 'SERVING_GENERATION_UNAVAILABLE');
  assert.equal(reconcileServingEvidence({ pointer, generations: [{ generationId: 'gen-a', state: 'SERVING' }, { generationId: 'gen-b', state: 'READY' }], promotions: [], healthByGeneration: new Map([['gen-b', 'healthy']]) }).classification, 'POINTER_REGISTRY_MISMATCH');
});

test('incomplete promotion is explicitly ambiguous and is never auto-repaired', () => {
  const value = reconcileServingEvidence({ pointer, generations, promotions: [{ id: 'p1', state: 'PREPARING' }], healthByGeneration: new Map([['gen-b', 'healthy']]) });
  assert.deepEqual(value, { classification: 'AMBIGUOUS_PROMOTION', ready: false, relatedGenerationIds: ['p1'] });
});

test('retention protects serving, rollback, ambiguous and newest failed generation', () => {
  const values = [
    { generationId: 'gen-a', state: 'RETIRING', createdAt: '2026-01-01' },
    { generationId: 'gen-b', state: 'SERVING', createdAt: '2026-01-02' },
    { generationId: 'gen-c', state: 'RETIRED', createdAt: '2026-01-03' },
    { generationId: 'gen-d', state: 'FAILED', createdAt: '2026-01-04' },
    { generationId: 'gen-e', state: 'FAILED', createdAt: '2026-01-05' },
    { generationId: 'gen-f', state: 'RETIRED', createdAt: '2026-01-06' },
  ];
  assert.deepEqual(selectGenerationCleanupCandidates({ generations: values, pointer, promotions: [{ state: 'PREPARING', fromGenerationId: 'gen-f', toGenerationId: 'gen-d' }] }), ['gen-c']);
  assert.throws(() => selectGenerationCleanupCandidates({ generations: values, pointer, promotions: [], retainFailed: 2 }), /retention/u);
});
