import assert from 'node:assert/strict';
import test from 'node:test';
import { instanceScopedIdentities, legacyOrInstanceIdentities } from './instance-identities.js';

const instanceId = 'a622a3e7-ff84-46bf-bf41-88410024e183';

test('derives bounded instance-scoped source and query identities', () => {
  assert.deepEqual(instanceScopedIdentities({ instanceId }), {
    instanceId,
    sourceIdentity: `custom-wikibase.${instanceId}`,
    queryServiceId: `custom-wikibase-query-${instanceId}`,
  });
});

test('retains legacy identities only when no instance identity input exists', () => {
  assert.equal(legacyOrInstanceIdentities().sourceIdentity, 'jwb-standalone');
  assert.throws(() => legacyOrInstanceIdentities({ instanceId: 'not-a-uuid' }), /INVALID_INSTANCE_IDENTITY/u);
  assert.throws(() => instanceScopedIdentities({ instanceId, sourceIdentity: 'jwb-standalone' }), /INVALID_QUERY_IDENTITY/u);
});
