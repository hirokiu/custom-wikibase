import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const MIGRATION = new URL('../../../packages/jwb-database/migrations/013_generation_control_plane_contract.sql', import.meta.url);

export async function verifyCoordinatorSchema(pool) {
  try {
    const expected=createHash('sha256').update(await readFile(MIGRATION,'utf8')).digest('hex');
    const migration=await pool.query("SELECT checksum FROM schema_migrations WHERE version='013_generation_control_plane_contract.sql'");
    if(migration.rowCount!==1||migration.rows[0].checksum!==expected)return false;
    const objects=await pool.query("SELECT to_regclass('rdf_generation_delete_attempt') attempts,to_regclass('rdf_generation_protection_audit') audit");
    if(!objects.rows[0]?.attempts||!objects.rows[0]?.audit)return false;
    const columns=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='rdf_coordinator_operation' AND column_name IN('operation_type','owner_pod_uid')");
    return columns.rowCount===2;
  } catch { return false; }
}
