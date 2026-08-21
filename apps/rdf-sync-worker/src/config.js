const BACKENDS = new Set(["fuseki-tdb2", "virtuoso", "oxigraph"]);
const CRASH_POINTS = new Set([
  "AFTER_RC_FETCH",
  "AFTER_RDF_FETCH",
  "AFTER_BACKEND_UPDATE",
  "AFTER_FENCE_BEFORE_CURSOR",
]);
export function loadConfig(env = process.env) {
  const runtimeType = env.JWB_SYNC_RUNTIME ?? "local-compose";
  if (!new Set(["local-compose", "standalone-compose", "kubernetes"]).has(runtimeType))
    throw new Error("JWB_SYNC_RUNTIME must be allowlisted");
  const backendType = env.JWB_SYNC_BACKEND;
  if (!BACKENDS.has(backendType))
    throw new Error("JWB_SYNC_BACKEND must be allowlisted");
  const sourceUrl = trustedUrl(
    env.JWB_SYNC_SOURCE_URL ?? "http://127.0.0.1:8180",
    "source",
    runtimeType,
  );
  const canonicalPublicUrl = publicUrl(
    env.JWB_CANONICAL_PUBLIC_URL ?? (runtimeType === "standalone-compose" ? "http://127.0.0.1:8280" : "http://127.0.0.1:8180"),
    "canonical public",
  );
  const sourceIdentity = env.JWB_SYNC_SOURCE_IDENTITY ?? "jwb-local";
  if (!/^[a-z0-9][a-z0-9.-]{0,127}$/u.test(sourceIdentity))
    throw new Error("invalid source identity");
  const generationId = env.JWB_SYNC_GENERATION_ID;
  if (!/^gen-(?:a|b)$/u.test(generationId ?? ""))
    throw new Error("fixed local generation ID is required");
  const pollIntervalMs = bounded(
      env.JWB_SYNC_POLL_INTERVAL_MS,
      100,
      60000,
      2000,
    ),
    pageSize = bounded(env.JWB_SYNC_PAGE_SIZE, 1, 100, 50),
    batchSize = bounded(env.JWB_SYNC_BATCH_SIZE, 1, 100, 50),
    port = bounded(env.JWB_SYNC_HEALTH_PORT, 1024, 65535, 9191);
  const crashAt = env.JWB_SYNC_CRASH_AT || null;
  if (crashAt !== null && !CRASH_POINTS.has(crashAt))
    throw new Error("JWB_SYNC_CRASH_AT must be an allowlisted qualification point");
  const databasePattern = runtimeType === "kubernetes"
    ? /^postgres(?:ql)?:\/\/[^@/]+:[^@/]+@controller-postgres\.jwb-system\.svc\.cluster\.local:5432\/jwb$/u
    : runtimeType === "standalone-compose"
    ? /^postgres(?:ql)?:\/\/[^@/]+:[^@/]+@jwb-postgresql:5432\/japan_wikibase_query$/u
    : /^postgres(?:ql)?:\/\/[^@/]+:[^@/]+@127\.0\.0\.1:\d+\/[a-z0-9_]+$/u;
  if (!databasePattern.test(env.JWB_SYNC_DATABASE_URL ?? ""))
    throw new Error("trusted PostgreSQL URL is required");
  return Object.freeze({
    backendType,
    runtimeType,
    sourceUrl: sourceUrl.toString().replace(/\/$/u, ""),
    canonicalPublicUrl: canonicalPublicUrl.toString().replace(/\/$/u, ""),
    sourceIdentity,
    generationId,
    normalizationModel: "jwb-rdf-normalization-v1",
    partitionModel: "jwb-partition-v1",
    pollIntervalMs,
    pageSize,
    batchSize,
    port,
    databaseUrl: env.JWB_SYNC_DATABASE_URL,
    crashAt,
  });
}
function trustedUrl(value, name, runtimeType) {
  const url = new URL(value);
  const expectedHost = runtimeType === "kubernetes"
    ? "japan-wikibase.jwb-instance-local-01.svc.cluster.local"
    : runtimeType === "standalone-compose" ? null
    : "127.0.0.1";
  if (
    url.protocol !== "http:" ||
    (expectedHost === null ? !/^wikibase(?:\.[a-z0-9](?:[-a-z0-9]*[a-z0-9])?\.svc\.cluster\.local)?$/u.test(url.hostname) : url.hostname !== expectedHost) ||
    url.username ||
    url.password
  )
    throw new Error(`${name} URL must be local HTTP`);
  return url;
}
function publicUrl(value, name) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error(`${name} URL must be an HTTP origin`);
  return url;
}
function bounded(value, min, max, fallback) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error("numeric configuration out of range");
  return n;
}
