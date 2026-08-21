import { createHash, randomUUID } from "node:crypto";
import {
  classifyChange,
  RevisionFence,
} from "../../../packages/rdf-sync/src/protocol.js";
import { entityGraphIri } from "../../../packages/rdf-sync/src/state.js";

export class RdfSyncEngine {
  /** @param {any} options */
  constructor({
    source,
    repository,
    fetcher,
    partitioner,
    backend,
    resolver,
    rebuildCoordinator,
    metrics,
    logger,
    backendType,
    clock = () => new Date(),
  }) {
    this.source = source;
    this.repository = repository;
    this.fetcher = fetcher;
    this.partitioner = partitioner;
    this.backend = backend;
    this.resolver = resolver;
    this.rebuildCoordinator = rebuildCoordinator;
    this.metrics = metrics;
    this.logger = logger;
    this.backendType = backendType;
    this.clock = clock;
  }
  async pollOnce({ pageSize = 50, batchSize = 50, crashAt = null, hardCrash = false } = {}) {
    const state = await this.repository.loadSource();
    const read = await this.source.read(state.cursor, pageSize);
    await this.repository.recordPoll(this.clock().toISOString());
    this.#crash(crashAt, "AFTER_RC_FETCH");
    for (const event of read.events.slice(0, batchSize)) {
      this.metrics.increment("events_seen_total");
      const result = await this.processEvent(event, { crashAt, hardCrash });
      if (result === "STOP") break;
    }
    return {
      seen: read.events.length,
      cursor: (await this.repository.loadSource()).cursor,
    };
  }
  async processEvent(event, { crashAt = null, hardCrash = false } = {}) {
    const classified = classifyChange(event);
    const cursor = {
      sourceIdentity: this.source.sourceIdentity,
      timestamp: event.timestamp,
      rcid: event.rcid,
    };
    const context = {
      entityId: classified.entityId,
      revision: event.revid,
      rcid: event.rcid,
      eventType: classified.action,
      backendType: this.backendType,
    };
    if (classified.action === "NON_ENTITY_CHANGE") {
      await this.repository.advanceCursor(cursor);
      return "SKIP";
    }
    if (!classified.entityId || classified.action === "UNKNOWN") {
      await this.#rebuildRequired("AMBIGUOUS_EVENT", context);
      return "STOP";
    }
    try {
      if (classified.action === "ENTITY_DELETE")
        return await this.#delete(
          classified.entityId,
          cursor,
          context,
          crashAt,
        );
      if (
        [
          "ENTITY_UNDELETE",
          "ENTITY_REDIRECT",
          "ENTITY_REDIRECT_REMOVED",
          "ENTITY_MERGE",
        ].includes(classified.action)
      )
        return await this.#lifecycle(
          classified,
          event,
          cursor,
          context,
          crashAt,
        );
      return await this.#edit(
        classified.entityId,
        event,
        cursor,
        context,
        crashAt,
      );
    } catch (error) {
      if (hardCrash && String(error?.message).startsWith("INJECTED_")) throw error;
      const code = sanitizeCode(error);
      this.metrics.increment("entity_sync_failures_total");
      this.logger.log("rdf_sync_event_failed", {
        ...context,
        result: "failed",
        errorCode: code,
      });
      await this.#rebuildRequired(code, context);
      return "STOP";
    }
  }
  async #edit(entityId, event, cursor, context, crashAt, commitCursor = true, forceRestore = false) {
    const row = await this.repository.loadEntity(entityId);
    if (forceRestore && !["DELETED", "RESTORING", "CURRENT"].includes(row.status)) throw new Error("UNDELETE_WITHOUT_TOMBSTONE");
    const fence = new RevisionFence(entityId, row.indexedRevision);
    const decision = fence.observe(event.revid, event.oldRevid);
    if (!forceRestore && decision.decision === "GAP_DETECTED") {
      this.metrics.increment("gap_events_total");
      await this.repository.saveEntity({
        ...row,
        latestSeenRevision: event.revid,
        status: "GAP",
        errorCode: "REVISION_GAP",
      });
      await this.#rebuildRequired("REVISION_GAP", context);
      return "STOP";
    }
    if (!forceRestore && !decision.write) {
      this.metrics.increment(
        decision.decision === "DUPLICATE"
          ? "duplicate_events_total"
          : "out_of_order_events_total",
      );
      if (commitCursor) await this.repository.advanceCursor(cursor);
      return decision.decision;
    }
    if (forceRestore) await this.repository.saveEntity({...row,status:"RESTORING",errorCode:null});
    const fetched = await this.fetcher.fetch(entityId, event.revid);
    this.#crash(crashAt, "AFTER_RDF_FETCH");
    const partition = this.partitioner.partition(fetched);
    const checksum = createHash("sha256")
      .update(partition.entityRdf)
      .digest("hex");
    this.#crash(crashAt, "BEFORE_BACKEND_UPDATE");
    await this.#replaceGraph(
      partition.entityGraphIri ?? entityGraphIri(entityId),
      partition.entityRdf,
      entityId,
      event.revid,
    );
    if (this.repository.registerGraph)
      await this.repository.registerGraph({
        graphIri: partition.entityGraphIri ?? entityGraphIri(entityId),
        partitionKind: "ENTITY",
        entityId,
      });
    if (entityId.startsWith("P")) {
      if (!partition.schemaGraphIri || !partition.schemaRdf)
        throw new Error("PROPERTY_SCHEMA_PARTITION_MISSING");
      await this.#replaceGraph(
        partition.schemaGraphIri,
        partition.schemaRdf,
        entityId,
        event.revid,
      );
      if (this.repository.registerGraph)
        await this.repository.registerGraph({
          graphIri: partition.schemaGraphIri,
          partitionKind: "PROPERTY_SCHEMA",
          entityId,
        });
      if (this.repository.setSchemaState)
        await this.repository.setSchemaState("CURRENT");
    }
    this.#crash(crashAt, "AFTER_BACKEND_UPDATE");
    if (!(await this.#verify(entityId, event.revid)))
      throw new Error("BACKEND_VERIFY_FAILED");
    const entity = {
      ...row,
      indexedRevision: event.revid,
      latestSeenRevision: Math.max(row.latestSeenRevision, event.revid),
      status: "CURRENT",
      checksum,
      lastSuccessAt: this.clock().toISOString(),
      errorCode: null,
    };
    this.#crash(crashAt, "BEFORE_FENCE_COMMIT");
    await this.repository.saveEntity(entity);
    this.#crash(crashAt, "AFTER_FENCE_BEFORE_CURSOR");
    if (commitCursor) await this.repository.commitEvent({ cursor, entity });
    this.metrics.increment("events_applied_total");
    return forceRestore ? "RESTORED" : "APPLIED";
  }
  async #delete(entityId, cursor, context, crashAt) {
    const row = await this.repository.loadEntity(entityId);
    const graphs = [
      entityGraphIri(entityId),
      ...(entityId.startsWith("P") ? [`urn:jwb:schema:${entityId}`] : []),
    ];
    for (const graphIri of graphs) {
      await this.backend.deleteNamedGraph({ graphIri });
      if (this.repository.unregisterGraph)
        await this.repository.unregisterGraph(graphIri);
    }
    this.#crash(crashAt, "AFTER_BACKEND_UPDATE");
    const entity = {
      ...row,
      status: "DELETED",
      checksum: null,
      lastSuccessAt: this.clock().toISOString(),
      errorCode: null,
    };
    await this.repository.commitEvent({ cursor, entity });
    this.metrics.increment("events_applied_total");
    return "DELETED";
  }
  async #lifecycle(classified, event, cursor, context, crashAt) {
    const resolved = await this.resolver.resolve(classified, event);
    if (
      !resolved?.unambiguous ||
      !Array.isArray(resolved.entities) ||
      resolved.entities.length === 0
    )
      throw new Error("AMBIGUOUS_LIFECYCLE");
    for (const entity of resolved.entities) {
      if (entity.deleted) {
        await this.backend.deleteNamedGraph({
          graphIri: entityGraphIri(entity.id),
        });
        await this.repository.saveEntity({
          ...(await this.repository.loadEntity(entity.id)),
          status: "DELETED",
        });
      } else {
        const old = (await this.repository.loadEntity(entity.id))
          .indexedRevision;
        const outcome = await this.#edit(
          entity.id,
          { ...event, revid: entity.revision, oldRevid: old },
          cursor,
          context,
          crashAt,
          false,
          classified.action === "ENTITY_UNDELETE",
        );
        if (outcome === "STOP") return "STOP";
      }
    }
    await this.repository.advanceCursor(cursor);
    return "LIFECYCLE_APPLIED";
  }
  async #verify(entityId, revision) {
    const value = await this.backend.query(
      `ASK { GRAPH <${entityGraphIri(entityId)}> { ?entity <http://schema.org/version> ?version FILTER(STRENDS(STR(?entity), "/${entityId}") && STR(?version) = "${revision}") } }`,
    );
    return value.boolean === true;
  }
  async #replaceGraph(graphIri, rdf, entityId, revision) {
    const source = await materialize(rdf, entityId, revision);
    try {
      await this.backend.replaceNamedGraph({
        graphIri,
        source,
        mediaType: "application/n-triples",
      });
    } finally {
      await removeMaterialized(source);
    }
  }
  async #rebuildRequired(code, context) {
    await this.repository.setSourceStatus("REBUILD_REQUIRED", code);
    this.logger.log("rdf_sync_rebuild_required", {
      ...context,
      result: "rebuild_required",
      errorCode: code,
    });
  }
  #crash(selected, point) {
    if (selected === point) throw new Error(`INJECTED_${point}`);
  }
  async rebuild({ snapshot, startCursor, endCursor, crashAt = null }) {
    const id = randomUUID(),
      started = this.clock();
    await this.repository.startRebuild({
      id,
      state: "REBUILDING",
      startCursor,
      startedAt: started.toISOString(),
      backendType: this.backendType,
    });
    this.metrics.increment("rebuild_total");
    try {
      await this.rebuildCoordinator.stage({ id, snapshot });
      this.#crash(crashAt, "DURING_REBUILD");
      await this.rebuildCoordinator.catchUp({
        id,
        startCursor,
        endCursor,
        engine: this,
      });
      this.#crash(crashAt, "BEFORE_CUTOVER");
      await this.rebuildCoordinator.cutover({ id });
      this.#crash(crashAt, "AFTER_CUTOVER");
      await this.repository.finishRebuild(id, {
        state: "HEALTHY",
        status: "HEALTHY",
        endCursor,
        completedAt: this.clock().toISOString(),
      });
      this.metrics.observe("rebuild_duration", this.clock() - started);
      return { id, status: "HEALTHY" };
    } catch (error) {
      this.metrics.increment("rebuild_failure_total");
      await this.repository.finishRebuild(id, {
        state: "REBUILD_REQUIRED",
        status: "REBUILD_REQUIRED",
        errorCode: sanitizeCode(error),
        completedAt: this.clock().toISOString(),
      });
      throw error;
    }
  }
}
async function materialize(rdf, entityId, revision) {
  const { writeFile } = await import("node:fs/promises");
  const path = `/tmp/wfp-rdf-sync-${entityId}-${revision}.nt`;
  await writeFile(path, rdf, { mode: 0o600 });
  return path;
}
async function removeMaterialized(path) {
  const { unlink } = await import("node:fs/promises");
  await unlink(path).catch(() => {});
}
function sanitizeCode(error) {
  const match = String(error?.message ?? "SYNC_FAILED").match(
    /[A-Z][A-Z0-9_]{2,63}/u,
  );
  return match?.[0] ?? "SYNC_FAILED";
}
