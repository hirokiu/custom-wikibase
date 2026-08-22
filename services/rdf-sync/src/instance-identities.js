const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SOURCE = /^custom-wikibase\.[0-9a-f-]{36}$/u;
const QUERY = /^custom-wikibase-query-[0-9a-f-]{36}$/u;

export function instanceScopedIdentities({ instanceId, sourceIdentity, queryServiceId }) {
  if (!UUID.test(instanceId ?? "")) throw new Error("INVALID_INSTANCE_IDENTITY");
  const source = sourceIdentity ?? `custom-wikibase.${instanceId}`;
  const query = queryServiceId ?? `custom-wikibase-query-${instanceId}`;
  if (!SOURCE.test(source) || !QUERY.test(query)) throw new Error("INVALID_QUERY_IDENTITY");
  return Object.freeze({ instanceId, sourceIdentity: source, queryServiceId: query });
}

export function legacyOrInstanceIdentities(input = {}) {
  if (!input.instanceId && !input.sourceIdentity && !input.queryServiceId) return Object.freeze({
    instanceId: "00000000-0000-4000-8000-000000000001",
    sourceIdentity: "jwb-standalone",
    queryServiceId: "jwb-standalone-query",
  });
  return instanceScopedIdentities(input);
}
