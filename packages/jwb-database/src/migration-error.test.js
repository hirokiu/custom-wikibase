import assert from 'node:assert/strict';
import test from 'node:test';
import { migrationErrorEvidence } from './migration-error.js';

test('classifies only known connection, checksum, lock and SQL failures', () => {
  assert.deepEqual(migrationErrorEvidence(Object.assign(new Error('closed'), { code: 'ECONNRESET' })), { errorCode: 'JWB_DB_CONNECTION_FAILED', causeCode: 'ECONNRESET' });
  assert.deepEqual(migrationErrorEvidence(new Error('MIGRATION_CHECKSUM_MISMATCH:005.sql')), { errorCode: 'JWB_MIGRATION_CHECKSUM_MISMATCH', causeCode: null });
  assert.deepEqual(migrationErrorEvidence(Object.assign(new Error('locked'), { code: '55P03' })), { errorCode: 'JWB_MIGRATION_LOCK_FAILED', causeCode: '55P03' });
  assert.deepEqual(migrationErrorEvidence(new Error('unexpected')), { errorCode: 'JWB_MIGRATION_UNKNOWN_FAILED', causeCode: null });
});
