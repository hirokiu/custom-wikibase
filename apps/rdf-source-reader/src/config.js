export function loadSourceReaderConfig(env = process.env) {
  const runtimeType = env.JWB_SOURCE_READER_RUNTIME ?? "local-compose";
  if (!new Set(["local-compose", "standalone-compose", "kubernetes"]).has(runtimeType))
    throw new Error("source reader runtime must be allowlisted");
  const sourceUrl = new URL(
    env.JWB_SOURCE_READER_URL ?? "http://127.0.0.1:8180",
  );
  if (
    sourceUrl.protocol !== "http:" ||
    sourceUrl.hostname !== (runtimeType === "kubernetes" ? "japan-wikibase.jwb-instance-local-01.svc.cluster.local" : runtimeType === "standalone-compose" ? "wikibase" : "127.0.0.1") ||
    sourceUrl.username ||
    sourceUrl.password
  )
    throw new Error("source URL must be local HTTP");
  const sourceIdentity = env.JWB_SOURCE_READER_IDENTITY ?? "jwb-local";
  if (!/^[a-z0-9][a-z0-9.-]{0,127}$/u.test(sourceIdentity))
    throw new Error("invalid source identity");
  if (
    !(runtimeType === "kubernetes"
      ? /^postgres(?:ql)?:\/\/[^@/]+:[^@/]+@controller-postgres\.jwb-system\.svc\.cluster\.local:5432\/jwb$/u
      : runtimeType === "standalone-compose"
      ? /^postgres(?:ql)?:\/\/[^@/]+:[^@/]+@jwb-postgresql:5432\/japan_wikibase_query$/u
      : /^postgres(?:ql)?:\/\/[^@/]+(?::[^@/]*)?@127\.0\.0\.1:\d+\/[a-z0-9_]+$/u).test(
      env.JWB_SOURCE_READER_DATABASE_URL ?? "",
    )
  )
    throw new Error("local PostgreSQL URL is required");
  const pollIntervalMs = bounded(
      env.JWB_SOURCE_READER_POLL_MS,
      100,
      60000,
      1000,
    ),
    pageSize = bounded(env.JWB_SOURCE_READER_PAGE_SIZE, 1, 100, 50);
  return Object.freeze({
    sourceUrl: sourceUrl.toString().replace(/\/$/u, ""),
    runtimeType,
    sourceIdentity,
    databaseUrl: env.JWB_SOURCE_READER_DATABASE_URL,
    pollIntervalMs,
    pageSize,
  });
}
function bounded(value, min, max, fallback) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error("numeric configuration out of range");
  return n;
}
