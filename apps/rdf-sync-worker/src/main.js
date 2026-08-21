#!/usr/bin/env node
import pg from "pg";
import { loadConfig } from "./config.js";
import { SyncMetrics } from "./metrics.js";
import { SyncLogger } from "./logger.js";
import { createSyncHealthServer } from "./health-server.js";
import { SyncWorkerRuntime } from "./runtime.js";
import { MediaWikiRecentChangesSource } from "../../../services/rdf-sync/src/mediawiki-change-source.js";
import { LocalRevisionAwareEntityFetcher } from "../../../services/rdf-sync/src/entity-rdf-fetcher.js";
import { WikibaseEntityPartitioner } from "../../../services/rdf-sync/src/entity-partitioner.js";
import { MediaWikiLifecycleResolver } from "../../../services/rdf-sync/src/mediawiki-lifecycle-resolver.js";
import { PostgresGenerationSyncRepository } from "../../../services/rdf-sync/src/postgres-generation-sync-repository.js";
import { RdfSyncEngine } from "../../../services/rdf-sync/src/sync-engine.js";
import { LocalComposeGenerationDriver } from "../../../services/rdf-sync/src/local-compose-generation-driver.js";
import { StandaloneComposeGenerationBackend } from "../../../services/rdf-sync/src/standalone-compose-generation-backend.js";
import { KubernetesGenerationDriver } from "../../../services/rdf-sync/src/kubernetes-generation-driver.js";
import { validateGenerationDescriptor } from "../../../packages/rdf-sync/src/generation-descriptor.js";
const config = loadConfig(),
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 3,
    connectionTimeoutMillis: 5000,
  }),
  repository = new PostgresGenerationSyncRepository({
    pool,
    sourceIdentity: config.sourceIdentity,
    generationId: config.generationId,
  }),
  metrics = new SyncMetrics(),
  logger = new SyncLogger(),
  driver = config.runtimeType === "kubernetes"
    ? new KubernetesGenerationDriver({backendType: config.backendType, core: {}, apps: {}})
    : config.runtimeType === "standalone-compose"
    ? new StandaloneComposeGenerationBackend({backendType: config.backendType,adminPassword:process.env.JWB_RDF_ADMIN_PASSWORD})
    : new LocalComposeGenerationDriver({backendType: config.backendType, adminPassword: process.env.JWB_RDF_ADMIN_PASSWORD}),
  physical = /** @type {any} */ (driver.descriptor(config.generationId)),
  physicalQueryUrl = config.runtimeType === "kubernetes" ? physical.queryEndpoint : physical.endpoints.queryUrl,
  physicalUpdateUrl = config.runtimeType === "kubernetes" ? physical.internalUpdateEndpoint : physical.endpoints.updateUrl,
  descriptor = validateGenerationDescriptor({
    generationId: config.generationId,
    sourceIdentity: config.sourceIdentity,
  backendType: config.backendType,
  normalizationModel: config.normalizationModel,
  partitionModel: config.partitionModel,
    queryEndpoint: {
      url: physicalQueryUrl,
      access: "internal-read",
    },
    internalUpdateEndpoint: {
      url: physicalUpdateUrl,
      access: "internal-write",
    },
  }),
  backend = driver.backend(descriptor.generationId, process.env.JWB_RDF_ADMIN_PASSWORD),
  source = new MediaWikiRecentChangesSource({
    apiUrl: `${config.sourceUrl}/api.php`,
    sourceIdentity: config.sourceIdentity,
  }),
  engine = new RdfSyncEngine({
    source,
    repository,
    fetcher: new LocalRevisionAwareEntityFetcher({ baseUrl: config.sourceUrl, canonicalPublicUrl: config.canonicalPublicUrl }),
    partitioner: new WikibaseEntityPartitioner(),
    backend,
    resolver: new MediaWikiLifecycleResolver({ baseUrl: config.sourceUrl }),
    rebuildCoordinator: null,
    metrics,
    logger,
    backendType: config.backendType,
  }),
  runtime = new SyncWorkerRuntime({
    engine,
    repository,
    backend,
    pollIntervalMs: config.pollIntervalMs,
    pageSize: config.pageSize,
    batchSize: config.batchSize,
    metrics,
    logger,
    crashAt: config.crashAt,
    crash: (point) => {
      logger.log("rdf_sync_worker_crash_injected", {
        backendType: config.backendType,
        result: "crashed",
        errorCode: `INJECTED_${point}`,
      });
      process.exit(86);
    },
  }),
  health = createSyncHealthServer({
    port: config.port,
    host: config.runtimeType === "local-compose" ? "127.0.0.1" : "0.0.0.0",
    state: runtime,
    metrics,
  });
pool.on("error", () => {});
await backend.initialize({ instanceId: "jwb-local-sync" });
await repository.loadSource();
await health.start();
logger.log("rdf_sync_worker_started", {
  backendType: config.backendType,
  result: "started",
});
const running = runtime.run();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    logger.log("rdf_sync_worker_stopping", {
      backendType: config.backendType,
      result: signal,
    });
    runtime.stop();
  });
await running;
await health.close();
await backend.shutdown();
await pool.end();
