import assert from 'node:assert/strict';
import test from 'node:test';
import { GenerationRetirementCoordinator } from './generation-retirement-coordinator.js';

test('cleanup is structured, idempotent and never targets serving or rollback generation', async () => {
  const rows = new Map([['gen-a', 'RETIRING'], ['gen-b', 'SERVING'], ['gen-c', 'RETIRED']]);
  const physical = new Set(['gen-a', 'gen-b', 'gen-c']);
  const repository = {
    async loadServingEvidence() { return { pointer: { generationId: 'gen-b', previousGenerationId: 'gen-a' }, generations: [...rows].map(([generationId, state]) => ({ generationId, state })), promotions: [] }; },
    async deleteRetiredGeneration({ generationId }) { assert.equal(rows.get(generationId), 'RETIRED'); rows.delete(generationId); },
  };
  const driver = { async deleteGeneration({ generationId }) { physical.delete(generationId); } };
  const coordinator = new GenerationRetirementCoordinator({ repository, driver });
  assert.deepEqual(await coordinator.cleanup(), { deleted: ['gen-c'] });
  assert.deepEqual(await coordinator.cleanup(), { deleted: [] });
  assert.deepEqual([...physical].sort(), ['gen-a', 'gen-b']);
});

test('crash after physical deletion is safe to retry', async () => {
  let first = true;
  const repository = {
    async loadServingEvidence() { return { pointer: { generationId: 'gen-b', previousGenerationId: 'gen-a' }, generations: [{ generationId: 'gen-c', state: 'RETIRED' }], promotions: [] }; },
    async deleteRetiredGeneration() { if (first) { first = false; throw new Error('CRASH_AFTER_PHYSICAL_DELETE'); } },
  };
  let calls = 0;
  const coordinator = new GenerationRetirementCoordinator({ repository, driver: { async deleteGeneration() { calls += 1; } } });
  await assert.rejects(coordinator.cleanup(), /CRASH/u);
  await coordinator.cleanup();
  assert.equal(calls, 2, 'idempotent driver accepts retry after an ambiguous physical result');
});
