export class PostgresServingPointerRepository {
  constructor({ pool, queryServiceId }) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(queryServiceId))
      throw new Error("invalid query service ID");
    this.pool = pool;
    this.queryServiceId = queryServiceId;
  }
  async get() {
    const r = await this.pool.query(
      "SELECT query_service_id,source_identity,generation_id,previous_generation_id,version,updated_at FROM rdf_serving_pointer WHERE query_service_id=$1",
      [this.queryServiceId],
    );
    if (r.rowCount !== 1) throw new Error("SERVING_POINTER_MISSING");
    const value = row(r.rows[0]),
      graphs = await this.pool.query(
        "SELECT graph_iri FROM rdf_generation_graph WHERE source_identity=$1 AND generation_id=$2 ORDER BY graph_iri",
        [value.sourceIdentity, value.generationId],
      );
    return { ...value, graphIris: graphs.rows.map((v) => v.graph_iri) };
  }
  async current() { return this.get(); }
  /** @internal Persistence primitive retained for isolated M7-M9 repository qualification. Normal runtime promotion must use GenerationCoordinatorRuntime. */
  async promote({
    generationId,
    expectedGenerationId,
    expectedVersion,
    promotionId,
  }) {
    generation(generationId);
    if (expectedGenerationId !== null) generation(expectedGenerationId);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
      throw new Error("invalid pointer version");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.#locked(client);
      if (
        current.version !== expectedVersion ||
        current.generationId !== expectedGenerationId
      )
        throw new Error("SERVING_POINTER_CONFLICT");
      const candidate = await client.query(
        "SELECT state,validation_status,normalization_model,partition_model,generation_manifest FROM rdf_generation WHERE source_identity=$1 AND generation_id=$2 FOR UPDATE",
        [current.sourceIdentity, generationId],
      );
      if (
        candidate.rowCount !== 1 ||
        candidate.rows[0].state !== "READY" ||
        candidate.rows[0].validation_status !== "VALID" ||
        candidate.rows[0].normalization_model !== "jwb-rdf-normalization-v1" ||
        candidate.rows[0].partition_model !== "jwb-partition-v1" ||
        candidate.rows[0].generation_manifest === null
      )
        throw new Error("CANDIDATE_NOT_READY");
      await client.query(
        "INSERT INTO rdf_generation_promotion(id,source_identity,from_generation_id,to_generation_id,state) VALUES($1,$2,$3,$4,'PREPARING')",
        [
          promotionId,
          current.sourceIdentity,
          current.generationId,
          generationId,
        ],
      );
      await client.query("UPDATE rdf_generation_retirement SET state='RETIRING',updated_at=now() WHERE source_identity=$1 AND state='ROLLBACK_PROTECTED'",[current.sourceIdentity]);
      await client.query("UPDATE rdf_generation SET protection_state='NONE',lifecycle_version=lifecycle_version+1 WHERE source_identity=$1 AND protection_state IN('SERVING','ROLLBACK')",[current.sourceIdentity]);
      if (current.generationId)
        await client.query(
          "UPDATE rdf_generation SET state='RETIRING',protection_state='ROLLBACK',lifecycle_version=lifecycle_version+1 WHERE source_identity=$1 AND generation_id=$2 AND state='SERVING'",
          [current.sourceIdentity, current.generationId],
        );
      await client.query(
        "UPDATE rdf_generation SET state='SERVING',protection_state='SERVING',promoted_at=now(),lifecycle_version=lifecycle_version+1 WHERE source_identity=$1 AND generation_id=$2",
        [current.sourceIdentity, generationId],
      );
      const updated = await client.query(
        "UPDATE rdf_serving_pointer SET previous_generation_id=generation_id,generation_id=$2,version=version+1,updated_at=now() WHERE query_service_id=$1 AND version=$3 RETURNING *",
        [this.queryServiceId, generationId, expectedVersion],
      );
      if (updated.rowCount !== 1) throw new Error("SERVING_POINTER_CONFLICT");
      await client.query(
        "UPDATE rdf_generation_promotion SET state='COMMITTED',completed_at=now() WHERE id=$1",
        [promotionId],
      );
      await client.query("COMMIT");
      return row(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async rollback({ expectedVersion, promotionId }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.#locked(client);
      if (current.version !== expectedVersion || !current.previousGenerationId)
        throw new Error("ROLLBACK_POINTER_CONFLICT");
      const previous = await client.query(
        "SELECT state,protection_state FROM rdf_generation WHERE source_identity=$1 AND generation_id=$2 FOR UPDATE",
        [current.sourceIdentity, current.previousGenerationId],
      );
      if (previous.rowCount !== 1 || previous.rows[0].state !== "RETIRING" || previous.rows[0].protection_state !== "ROLLBACK")
        throw new Error("ROLLBACK_GENERATION_UNAVAILABLE");
      await client.query("UPDATE rdf_generation SET protection_state='NONE',lifecycle_version=lifecycle_version+1 WHERE source_identity=$1 AND protection_state IN('SERVING','ROLLBACK')",[current.sourceIdentity]);
      await client.query(
        "UPDATE rdf_generation SET state='READY',protection_state='ROLLBACK',lifecycle_version=lifecycle_version+1 WHERE source_identity=$1 AND generation_id=$2 AND state='SERVING' AND protection_state='NONE'",
        [current.sourceIdentity, current.generationId],
      );
      await client.query(
        "UPDATE rdf_generation SET state='SERVING',protection_state='SERVING',promoted_at=now(),lifecycle_version=lifecycle_version+1 WHERE source_identity=$1 AND generation_id=$2 AND protection_state='NONE'",
        [current.sourceIdentity, current.previousGenerationId],
      );
      const updated = await client.query(
        "UPDATE rdf_serving_pointer SET generation_id=previous_generation_id,previous_generation_id=$2,version=version+1,updated_at=now() WHERE query_service_id=$1 AND version=$3 RETURNING *",
        [this.queryServiceId, current.generationId, expectedVersion],
      );
      await client.query(
        "UPDATE rdf_generation_promotion SET state='ROLLED_BACK',completed_at=now() WHERE id=$1 AND state='COMMITTED'",
        [promotionId],
      );
      await client.query("COMMIT");
      return row(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async #locked(client) {
    const r = await client.query(
      "SELECT query_service_id,source_identity,generation_id,previous_generation_id,version,updated_at FROM rdf_serving_pointer WHERE query_service_id=$1 FOR UPDATE",
      [this.queryServiceId],
    );
    if (r.rowCount !== 1) throw new Error("SERVING_POINTER_MISSING");
    return row(r.rows[0]);
  }
}
function row(v) {
  return {
    queryServiceId: v.query_service_id,
    sourceIdentity: v.source_identity,
    generationId: v.generation_id,
    previousGenerationId: v.previous_generation_id,
    version: Number(v.version),
    updatedAt: v.updated_at,
  };
}
function generation(v) {
  if (!/^gen-[a-z0-9][a-z0-9-]{0,58}$/u.test(v))
    throw new Error("invalid generation ID");
}
