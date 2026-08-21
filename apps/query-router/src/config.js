const BACKENDS = new Set(['virtuoso', 'oxigraph', 'fuseki-tdb2']);
export function loadRouterConfig(env = process.env) {
  const runtimeType = env.JWB_ROUTER_RUNTIME ?? 'compose';
  const backendType = env.JWB_ROUTER_BACKEND;
  const generationBackends = Object.freeze({ 'gen-a': env.JWB_ROUTER_BACKEND_A ?? backendType, 'gen-b': env.JWB_ROUTER_BACKEND_B ?? backendType });
  if (!BACKENDS.has(generationBackends['gen-a']) || !BACKENDS.has(generationBackends['gen-b'])) throw new Error('router generation backends must be allowlisted');
  const queryServiceId = env.JWB_ROUTER_QUERY_SERVICE_ID ?? 'jwb-local-query';
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(queryServiceId)) throw new Error('invalid query service ID');
  const database=env.JWB_ROUTER_DATABASE_URL??'',local=/^postgres(?:ql)?:\/\/[^@/]+:[^@/]+@127\.0\.0\.1:\d+\/[a-z0-9_]+$/u,standalone=/^postgres(?:ql)?:\/\/[^@/]+:[^@/]+@jwb-postgresql:5432\/japan_wikibase_query$/u,kubernetes=/^postgres(?:ql)?:\/\/[^@/]+:[^@/]+@controller-postgres\.jwb-system\.svc\.cluster\.local:5432\/jwb$/u;
  if (!['compose','standalone-compose','kubernetes'].includes(runtimeType)||(runtimeType==='compose'?!local.test(database):runtimeType==='standalone-compose'?!standalone.test(database):!kubernetes.test(database))) throw new Error('local PostgreSQL URL is required');
  const port = bounded(env.JWB_ROUTER_PORT, 1024, 65535, 19200);
  return Object.freeze({ runtimeType,backendType: generationBackends['gen-a'] === generationBackends['gen-b'] ? generationBackends['gen-a'] : null, generationBackends, queryServiceId, databaseUrl: database, port });
}
function bounded(value, min, max, fallback) { const number = value === undefined ? fallback : Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new Error('invalid router port'); return number; }
