import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { migrate } from '../../../packages/jwb-database/src/migration-runner.js';
import { PostgresServingPointerRepository } from './postgres-serving-pointer-repository.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration('serving pointer promotion is CAS-serialized and rollback restores the prior generation', async (context) => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
  context.after(() => pool.end());
  await migrate(pool);
  const suffix = randomUUID();
  const sourceIdentity = `m7-${suffix}`;
  const queryServiceId = `m7-${suffix.slice(0, 18)}`;
  await pool.query(
    "INSERT INTO rdf_sync_source(source_identity,instance_id,backend_type,status) VALUES($1,$2,'fuseki-tdb2','HEALTHY')",
    [sourceIdentity, randomUUID()],
  );
  const generation = async (id, state, promotedAt) => pool.query(
    "INSERT INTO rdf_generation(source_identity,generation_id,backend_type,state,source_snapshot_timestamp,source_snapshot_rcid,validation_status,validation_checksum,promoted_at,normalization_model,generation_manifest) VALUES($1,$2,$3,$4,now(),1,$5,$6,$7,'jwb-rdf-normalization-v1','{}')",
    [sourceIdentity, id, 'fuseki-tdb2', state, 'VALID', 'a'.repeat(64), promotedAt],
  );
  await generation('gen-a', 'SERVING', new Date());
  await generation('gen-b', 'READY', null);
  await pool.query('INSERT INTO rdf_query_service(query_service_id,source_identity) VALUES($1,$2)', [queryServiceId, sourceIdentity]);
  await pool.query('INSERT INTO rdf_serving_pointer(query_service_id,source_identity,generation_id) VALUES($1,$2,$3)', [queryServiceId, sourceIdentity, 'gen-a']);
  await pool.query("UPDATE rdf_generation SET protection_state='SERVING' WHERE source_identity=$1 AND generation_id='gen-a'",[sourceIdentity]);
  const repositoryA = new PostgresServingPointerRepository({ pool, queryServiceId });
  const repositoryB = new PostgresServingPointerRepository({ pool, queryServiceId });
  await pool.query("INSERT INTO rdf_generation(source_identity,generation_id,backend_type,state,source_snapshot_timestamp,source_snapshot_rcid,validation_status,validation_checksum) VALUES($1,'gen-legacy','fuseki-tdb2','READY',now(),1,'VALID',$2)",[sourceIdentity,'c'.repeat(64)]);
  await assert.rejects(repositoryA.promote({generationId:'gen-legacy',expectedGenerationId:'gen-a',expectedVersion:1,promotionId:randomUUID()}),/CANDIDATE_NOT_READY/u);
  const promotionA = randomUUID();
  const promotionB = randomUUID();
  const attempts = await Promise.allSettled([
    repositoryA.promote({ generationId: 'gen-b', expectedGenerationId: 'gen-a', expectedVersion: 1, promotionId: promotionA }),
    repositoryB.promote({ generationId: 'gen-b', expectedGenerationId: 'gen-a', expectedVersion: 1, promotionId: promotionB }),
  ]);
  assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 1);
  const rejected = attempts.find(({ status }) => status === 'rejected');
  assert.equal(rejected?.status, 'rejected');
  if (rejected.status === 'rejected') assert.match(String(rejected.reason), /SERVING_POINTER_CONFLICT/u);
  const promoted = await repositoryA.get();
  assert.deepEqual({ generationId: promoted.generationId, previousGenerationId: promoted.previousGenerationId, version: promoted.version }, { generationId: 'gen-b', previousGenerationId: 'gen-a', version: 2 });
  const committed = await pool.query("SELECT id FROM rdf_generation_promotion WHERE state='COMMITTED' AND source_identity=$1", [sourceIdentity]);
  assert.equal(committed.rowCount, 1);
  const rolledBack = await repositoryA.rollback({ expectedVersion: 2, promotionId: committed.rows[0].id });
  assert.deepEqual({ generationId: rolledBack.generationId, previousGenerationId: rolledBack.previousGenerationId, version: rolledBack.version }, { generationId: 'gen-a', previousGenerationId: 'gen-b', version: 3 });
  await assert.rejects(repositoryB.rollback({ expectedVersion: 2, promotionId: committed.rows[0].id }), /ROLLBACK_POINTER_CONFLICT/u);
  const states = await pool.query('SELECT generation_id,state FROM rdf_generation WHERE source_identity=$1 ORDER BY generation_id', [sourceIdentity]);
  assert.deepEqual(states.rows, [{ generation_id: 'gen-a', state: 'SERVING' }, { generation_id: 'gen-b', state: 'READY' },{generation_id:'gen-legacy',state:'READY'}]);
});
