import { legacyOrInstanceIdentities } from './instance-identities.js';
export async function bootstrapStandaloneJwb({pool,backendType,instanceId,sourceIdentity,queryServiceId}){
  if(!pool||!['virtuoso','fuseki-tdb2','oxigraph'].includes(backendType))throw new Error('INVALID_STANDALONE_BOOTSTRAP');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('japan-wikibase-standalone-bootstrap',0))");
    const identity=legacyOrInstanceIdentities({instanceId,sourceIdentity,queryServiceId}),source=identity.sourceIdentity,query=identity.queryServiceId,checksum='0'.repeat(64);
    await client.query("INSERT INTO rdf_sync_source(source_identity,instance_id,backend_type,status,legacy_state_resolution) VALUES($1,$2,$3,'BOOTSTRAPPING','EMPTY_CONFIRMED') ON CONFLICT(source_identity) DO UPDATE SET backend_type=EXCLUDED.backend_type WHERE rdf_sync_source.backend_type=EXCLUDED.backend_type",[source,identity.instanceId,backendType]);
    for(const [id,state] of [['gen-a','SERVING'],['gen-b','READY']])await client.query(`INSERT INTO rdf_generation(source_identity,generation_id,backend_type,state,source_snapshot_timestamp,source_snapshot_rcid,validation_status,validation_checksum,promoted_at,normalization_model,partition_model,generation_manifest,runtime_type,protection_state) VALUES($1,$2,$3,$4,to_timestamp(0),0,'VALID',$5,CASE WHEN $6 THEN now() ELSE NULL END,'jwb-rdf-normalization-v1','jwb-partition-v1','{}','compose',CASE WHEN $6 THEN 'SERVING' ELSE 'NONE' END) ON CONFLICT(source_identity,generation_id) DO UPDATE SET generation_id=EXCLUDED.generation_id WHERE rdf_generation.backend_type=EXCLUDED.backend_type`,[source,id,backendType,state,checksum,state==='SERVING']);
    await client.query("INSERT INTO rdf_query_service(query_service_id,source_identity) VALUES($1,$2) ON CONFLICT(query_service_id) DO NOTHING",[query,source]);
    await client.query("INSERT INTO rdf_serving_pointer(query_service_id,source_identity,generation_id) VALUES($1,$2,'gen-a') ON CONFLICT(query_service_id) DO NOTHING",[query,source]);
    for(const id of['gen-a','gen-b'])await client.query("INSERT INTO rdf_generation_sync(source_identity,generation_id,snapshot_cursor_timestamp,snapshot_cursor_rcid,catchup_cursor_timestamp,catchup_cursor_rcid,state,schema_state) VALUES($1,$2,to_timestamp(0),0,to_timestamp(0),0,'BOOTSTRAPPING','PENDING') ON CONFLICT(source_identity,generation_id) DO NOTHING",[source,id]);
    await client.query('COMMIT');
    return Object.freeze({sourceIdentity:source,queryServiceId:query,servingGeneration:'gen-a',candidateGeneration:'gen-b'});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
