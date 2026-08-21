import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { migrate } from '../../../packages/jwb-database/src/migration-runner.js';
import { PostgresGenerationSyncRepository, PostgresSourceIngestionRepository } from './postgres-generation-sync-repository.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration('generation cursors, fences and graph registry are isolated and durable', async (context) => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 }); context.after(() => pool.end()); await migrate(pool);
  const sourceIdentity = `m9a-${randomUUID()}`;
  await pool.query("INSERT INTO rdf_sync_source(source_identity,instance_id,backend_type,status,legacy_state_resolution) VALUES($1,$2,'virtuoso','BOOTSTRAPPING','EMPTY_CONFIRMED')", [sourceIdentity, randomUUID()]);
  for (const generationId of ['gen-a', 'gen-b']) await pool.query("INSERT INTO rdf_generation(source_identity,generation_id,backend_type,state,source_snapshot_timestamp,source_snapshot_rcid,validation_status) VALUES($1,$2,'virtuoso','CREATING',now(),10,'PENDING')", [sourceIdentity, generationId]);
  const a = new PostgresGenerationSyncRepository({ pool, sourceIdentity, generationId: 'gen-a' });
  const b = new PostgresGenerationSyncRepository({ pool, sourceIdentity, generationId: 'gen-b' });
  const c0 = { sourceIdentity, timestamp: '2026-08-19T00:00:10Z', rcid: 10 };
  await a.initialize({ snapshotCursor: c0 }); await b.initialize({ snapshotCursor: c0 });
  const entity = (revision) => ({ entityId: 'Q1', indexedRevision: revision, latestSeenRevision: revision, status: 'CURRENT', checksum: 'a'.repeat(64), lastSuccessAt: '2026-08-19T00:00:11Z', errorCode: null });
  await a.commitEvent({ cursor: { ...c0, timestamp: '2026-08-19T00:00:11Z', rcid: 11 }, entity: entity(20) });
  await b.commitEvent({ cursor: { ...c0, timestamp: '2026-08-19T00:00:12Z', rcid: 12 }, entity: entity(21) });
  assert.equal((await a.loadEntity('Q1')).indexedRevision, 20); assert.equal((await b.loadEntity('Q1')).indexedRevision, 21);
  assert.equal((await a.loadSource()).cursor.rcid, 11); assert.equal((await b.loadSource()).cursor.rcid, 12);
  await b.registerGraph({ graphIri: 'urn:jwb:entity:Q1', partitionKind: 'ENTITY', entityId: 'Q1' });
  await b.registerGraph({ graphIri: 'urn:jwb:global', partitionKind: 'GLOBAL' });
  assert.deepEqual(await b.listGraphIris(), ['urn:jwb:entity:Q1', 'urn:jwb:global']);
  await assert.rejects(b.markCurrent(), /SCHEMA_NOT_CURRENT/u); await b.setSchemaState('CURRENT'); await b.markCurrent(); assert.equal((await b.loadSource()).status, 'CURRENT');
  await assert.rejects(pool.query('DELETE FROM rdf_generation WHERE source_identity=$1 AND generation_id=$2', [sourceIdentity, 'gen-b']), (error) => /** @type {any} */ (error).code === '23503');
  const ingestion = new PostgresSourceIngestionRepository({ pool, sourceIdentity }); assert.equal(await ingestion.loadCursor(), null); await ingestion.advanceCursor(c0); assert.equal((await ingestion.loadCursor()).rcid, 10); await assert.rejects(ingestion.advanceCursor(c0), /CONFLICT/u);
});

integration('ambiguous legacy source state fails closed', async (context) => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 }); context.after(() => pool.end()); await migrate(pool);
  const sourceIdentity = `legacy-${randomUUID()}`;
  await pool.query("INSERT INTO rdf_sync_source(source_identity,instance_id,backend_type,status) VALUES($1,$2,'virtuoso','BOOTSTRAPPING')", [sourceIdentity, randomUUID()]);
  await assert.rejects(new PostgresSourceIngestionRepository({ pool, sourceIdentity }).loadCursor(), /LEGACY_SYNC_STATE_AMBIGUOUS/u);
});
