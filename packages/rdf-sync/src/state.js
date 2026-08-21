export const ENTITY_SYNC_STATES = Object.freeze([
  "CURRENT",
  "PENDING",
  "FAILED",
  "GAP",
  "DELETED",
  "RESTORING",
  "REDIRECT",
]);
export function entityGraphIri(entityId) {
  if (!/^[QP][1-9][0-9]*$/u.test(entityId))
    throw new Error("invalid entity ID");
  return `urn:jwb:entity:${entityId}`;
}
export class MemorySyncRepository {
  constructor(sourceIdentity) {
    this.source = {
      sourceIdentity,
      cursor: null,
      status: "BOOTSTRAPPING",
      lastPollAt: null,
      lastSuccessAt: null,
      errorCode: null,
    };
    this.entities = new Map();
    this.rebuilds = [];
    this.graphs = new Set();
    this.schemaState = "PENDING";
  }
  async loadSource() {
    return structuredClone(this.source);
  }
  async recordPoll(at) {
    this.source.lastPollAt = at;
  }
  async setSourceStatus(status, errorCode = null) {
    this.source.status = status;
    this.source.errorCode = errorCode;
  }
  async loadEntity(id) {
    return structuredClone(
      this.entities.get(id) ?? {
        entityId: id,
        indexedRevision: 0,
        latestSeenRevision: 0,
        status: "PENDING",
        checksum: null,
      },
    );
  }
  async saveEntity(value) {
    this.entities.set(value.entityId, structuredClone(value));
  }
  async commitEvent({ cursor, entity = null }) {
    if (
      this.source.cursor &&
      (cursor.timestamp < this.source.cursor.timestamp ||
        (cursor.timestamp === this.source.cursor.timestamp &&
          cursor.rcid <= this.source.cursor.rcid))
    )
      throw new Error("CURSOR_REGRESSION");
    if (entity) this.entities.set(entity.entityId, structuredClone(entity));
    this.source.cursor = structuredClone(cursor);
    this.source.lastSuccessAt = new Date().toISOString();
  }
  async advanceCursor(cursor) {
    return this.commitEvent({ cursor });
  }
  async startRebuild(value) {
    this.rebuilds.push(structuredClone(value));
    this.source.status = "REBUILDING";
  }
  async finishRebuild(id, value) {
    const row = this.rebuilds.find((v) => v.id === id);
    Object.assign(row, value);
    this.source.status = value.status;
  }
  async registerGraph({ graphIri }) {
    this.graphs.add(graphIri);
  }
  async unregisterGraph(graphIri) {
    this.graphs.delete(graphIri);
  }
  async setSchemaState(state) {
    this.schemaState = state;
  }
  async counts() {
    const values = [...this.entities.values()];
    return {
      current: values.filter((v) => v.status === "CURRENT").length,
      failed: values.filter((v) => ["FAILED", "GAP"].includes(v.status)).length,
    };
  }
}
