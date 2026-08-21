import { randomUUID } from 'node:crypto';

const SOURCE = 'jwb-standalone';
const QUERY = 'jwb-standalone-query';
const SLOTS = new Set(['gen-a', 'gen-b']);
const MODEL = 'jwb-rdf-normalization-v1';
const PARTITION = 'jwb-partition-v1';

export class StandalonePromotionCoordinator {
  constructor({ pool, routerObserver }) {
    if (!pool || typeof routerObserver !== 'function') throw new Error('INVALID_STANDALONE_PROMOTION_COORDINATOR');
    this.pool = pool;
    this.routerObserver = routerObserver;
  }

  async status() {
    const pointer = await this.#pointer();
    const generations = await this.pool.query(`SELECT g.generation_id,g.state,g.protection_state,g.validation_status,
      g.normalization_model,g.partition_model,s.state sync_state,s.schema_state
      FROM rdf_generation g JOIN rdf_generation_sync s USING(source_identity,generation_id)
      WHERE g.source_identity=$1 ORDER BY g.generation_id`, [SOURCE]);
    const journal = await this.pool.query(`SELECT id,from_generation_id,to_generation_id,state,phase,
      expected_pointer_version,resulting_pointer_version,created_at,completed_at
      FROM rdf_generation_promotion WHERE source_identity=$1 ORDER BY created_at DESC LIMIT 1`, [SOURCE]);
    return Object.freeze({ pointer, generations: generations.rows.map(generation), lastPromotion: journal.rows[0] ? promotion(journal.rows[0]) : null });
  }

  async promote({ mode, crashAt = null }) {
    if (!['PROMOTE', 'ROLLBACK'].includes(mode) || ![null, 'BEFORE_POINTER_CAS', 'AFTER_POINTER_CAS'].includes(crashAt))
      throw new Error('INVALID_STANDALONE_PROMOTION_REQUEST');
    const initialPointer = await this.#pointer();
    let pending = await this.#pending();
    if (!pending && ((mode === 'PROMOTE' && initialPointer.generationId === 'gen-b')
      || (mode === 'ROLLBACK' && initialPointer.generationId === 'gen-a' && initialPointer.previousGenerationId === 'gen-b'))) {
      const done = await this.#completed(initialPointer.generationId);
      if (done) return Object.freeze({ ...done, idempotent: true });
    }
    if (!pending) {
      const precondition = await this.#precondition(mode);
      const id = randomUUID();
      const inserted = await this.pool.query(`INSERT INTO rdf_generation_promotion
        (id,source_identity,from_generation_id,to_generation_id,state,phase,expected_pointer_version)
        VALUES($1,$2,$3,$4,'PREPARING','PREPARING',$5) RETURNING *`,
      [id, SOURCE, precondition.from, precondition.to, precondition.pointerVersion]);
      pending = promotion(inserted.rows[0]);
    }
    if (crashAt === 'BEFORE_POINTER_CAS' && pending.phase === 'PREPARING') throw new Error('QUALIFICATION_CRASH_BEFORE_POINTER_CAS');
    pending = await this.#cas(pending);
    if (crashAt === 'AFTER_POINTER_CAS' && pending.phase === 'POINTER_UPDATED') throw new Error('QUALIFICATION_CRASH_AFTER_POINTER_CAS');
    if (pending.phase === 'POINTER_UPDATED') {
      const observed = await this.routerObserver({ generationId: pending.toGenerationId, version: pending.resultingPointerVersion });
      if (!observed) throw new Error('ROUTER_PROMOTION_NOT_OBSERVED');
      const row = await this.pool.query(`UPDATE rdf_generation_promotion SET phase='ROUTER_VERIFIED',
        router_verified_at=now(),updated_at=now() WHERE id=$1 AND phase='POINTER_UPDATED' RETURNING *`, [pending.id]);
      if (row.rowCount !== 1) throw new Error('PROMOTION_PHASE_CONFLICT');
      pending = promotion(row.rows[0]);
    }
    if (pending.phase === 'ROUTER_VERIFIED') pending = await this.#finalize(pending);
    return Object.freeze({ ...pending, idempotent: false });
  }

  async #precondition(mode) {
    const pointer = await this.#pointer();
    if (!SLOTS.has(pointer.generationId)) throw new Error('SERVING_SLOT_INVALID');
    const to = pointer.generationId === 'gen-a' ? 'gen-b' : 'gen-a';
    if (mode === 'PROMOTE' && pointer.generationId !== 'gen-a') throw new Error('PROMOTION_ALREADY_APPLIED');
    if (mode === 'ROLLBACK' && pointer.previousGenerationId !== to) throw new Error('ROLLBACK_SLOT_NOT_RETAINED');
    const result = await this.pool.query(`SELECT g.state,g.protection_state,g.validation_status,g.validation_checksum,
      g.normalization_model,g.partition_model,g.generation_manifest,s.state sync_state,s.schema_state,
      s.catchup_cursor_timestamp,s.catchup_cursor_rcid,src.ingestion_cursor_timestamp,src.ingestion_cursor_rcid
      FROM rdf_generation g JOIN rdf_generation_sync s USING(source_identity,generation_id)
      JOIN rdf_sync_source src USING(source_identity) WHERE g.source_identity=$1 AND g.generation_id=$2`, [SOURCE, to]);
    const row = result.rows[0];
    if (result.rowCount !== 1 || row.state !== 'READY' || row.protection_state === 'SERVING'
      || row.validation_status !== 'VALID' || !/^[0-9a-f]{64}$/u.test(row.validation_checksum ?? '')
      || row.normalization_model !== MODEL || row.partition_model !== PARTITION || row.generation_manifest === null)
      throw new Error('CANDIDATE_NOT_VALIDATED');
    if (row.sync_state !== 'CURRENT' || row.schema_state !== 'CURRENT'
      || compare(row.catchup_cursor_timestamp, row.catchup_cursor_rcid, row.ingestion_cursor_timestamp, row.ingestion_cursor_rcid) < 0)
      throw new Error('CANDIDATE_NOT_CURRENT');
    return { from: pointer.generationId, to, pointerVersion: pointer.version };
  }

  async #cas(value) {
    if (value.phase !== 'PREPARING') return value;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM rdf_generation_promotion WHERE id=$1 FOR UPDATE', [value.id]);
      const journal = promotion(locked.rows[0]);
      if (journal.phase !== 'PREPARING') { await client.query('COMMIT'); return journal; }
      const pointer = await client.query(`UPDATE rdf_serving_pointer SET previous_generation_id=generation_id,
        generation_id=$2,version=version+1,updated_at=now() WHERE query_service_id=$1 AND source_identity=$3
        AND generation_id=$4 AND version=$5 RETURNING version`,
      [QUERY, journal.toGenerationId, SOURCE, journal.fromGenerationId, journal.expectedPointerVersion]);
      if (pointer.rowCount !== 1) throw new Error('STANDALONE_POINTER_CAS_CONFLICT');
      const updated = await client.query(`UPDATE rdf_generation_promotion SET phase='POINTER_UPDATED',
        resulting_pointer_version=$2,updated_at=now() WHERE id=$1 RETURNING *`, [journal.id, pointer.rows[0].version]);
      await client.query('COMMIT');
      return promotion(updated.rows[0]);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async #finalize(value) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM rdf_generation_promotion WHERE id=$1 FOR UPDATE', [value.id]);
      const journal = promotion(locked.rows[0]);
      if (journal.phase === 'GENERATION_FINALIZED') { await client.query('COMMIT'); return journal; }
      if (journal.phase !== 'ROUTER_VERIFIED') throw new Error('PROMOTION_PHASE_CONFLICT');
      await client.query("UPDATE rdf_generation SET protection_state='NONE',lifecycle_version=lifecycle_version+1 WHERE source_identity=$1 AND protection_state IN('SERVING','ROLLBACK')", [SOURCE]);
      const old = await client.query("UPDATE rdf_generation SET state='RETIRING',protection_state='ROLLBACK',lifecycle_version=lifecycle_version+1 WHERE source_identity=$1 AND generation_id=$2 AND state='SERVING' RETURNING generation_id", [SOURCE, journal.fromGenerationId]);
      const serving = await client.query("UPDATE rdf_generation SET state='SERVING',protection_state='SERVING',promoted_at=now(),lifecycle_version=lifecycle_version+1 WHERE source_identity=$1 AND generation_id=$2 AND state='READY' RETURNING generation_id", [SOURCE, journal.toGenerationId]);
      if (old.rowCount !== 1 || serving.rowCount !== 1) throw new Error('PROMOTION_GENERATION_CONFLICT');
      const updated = await client.query("UPDATE rdf_generation_promotion SET phase='GENERATION_FINALIZED',state='COMMITTED',completed_at=now(),updated_at=now() WHERE id=$1 RETURNING *", [journal.id]);
      await client.query('COMMIT');
      return promotion(updated.rows[0]);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async #pointer() {
    const result = await this.pool.query('SELECT generation_id,previous_generation_id,version FROM rdf_serving_pointer WHERE query_service_id=$1 AND source_identity=$2', [QUERY, SOURCE]);
    if (result.rowCount !== 1) throw new Error('SERVING_POINTER_MISSING');
    return { generationId: result.rows[0].generation_id, previousGenerationId: result.rows[0].previous_generation_id, version: Number(result.rows[0].version) };
  }
  async #pending() { const row = await this.pool.query("SELECT * FROM rdf_generation_promotion WHERE source_identity=$1 AND state='PREPARING' ORDER BY created_at LIMIT 1", [SOURCE]); return row.rows[0] ? promotion(row.rows[0]) : null; }
  async #completed(to) { const row = await this.pool.query("SELECT * FROM rdf_generation_promotion WHERE source_identity=$1 AND to_generation_id=$2 AND state='COMMITTED' ORDER BY completed_at DESC LIMIT 1", [SOURCE, to]); return row.rows[0] ? promotion(row.rows[0]) : null; }
}

function promotion(row) { if (!row) throw new Error('PROMOTION_JOURNAL_MISSING'); return { id: row.id, fromGenerationId: row.from_generation_id, toGenerationId: row.to_generation_id, state: row.state, phase: row.phase, expectedPointerVersion: Number(row.expected_pointer_version), resultingPointerVersion: row.resulting_pointer_version === null ? null : Number(row.resulting_pointer_version), createdAt: row.created_at, completedAt: row.completed_at }; }
function generation(row) { return { generationId: row.generation_id, state: row.state, protectionState: row.protection_state, validationStatus: row.validation_status, normalizationModel: row.normalization_model, partitionModel: row.partition_model, syncState: row.sync_state, schemaState: row.schema_state }; }
function compare(aTime, aId, bTime, bId) { const a = Date.parse(aTime), b = Date.parse(bTime); return a === b ? Number(aId) - Number(bId) : a - b; }
