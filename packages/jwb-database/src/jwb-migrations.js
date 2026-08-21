import{migrate,migrationStatus}from'./migration-runner.js';
export const JWB_MIGRATIONS=Object.freeze(['005_rdf_sync_runtime.sql','006_rdf_generation_lifecycle.sql','007_query_serving_pointer.sql','008_generation_scoped_sync.sql','009_rdf_normalization_manifest.sql','010_generation_coordinator.sql','011_retirement_safety_contract.sql','012_retirement_delete_evidence.sql','013_generation_control_plane_contract.sql']);
export const migrateJwb=(pool,options={})=>migrate(pool,{...options,allowlist:JWB_MIGRATIONS});
export const jwbMigrationStatus=(pool,options={})=>migrationStatus(pool,{...options,allowlist:JWB_MIGRATIONS});
