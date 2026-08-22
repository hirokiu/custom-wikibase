import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresServingPointerRepository } from '../../../services/rdf-sync/src/postgres-serving-pointer-repository.js';
import { legacyOrInstanceIdentities } from '../../../services/rdf-sync/src/instance-identities.js';

const url=process.env.JWB_ROUTER_DATABASE_URL,target=process.argv[2];
const identities=legacyOrInstanceIdentities({instanceId:process.env.JWB_INSTANCE_ID,sourceIdentity:process.env.JWB_SOURCE_IDENTITY,queryServiceId:process.env.JWB_QUERY_SERVICE_ID});
if(!/^postgres(?:ql)?:\/\/[^@/]+:[^@/]+@jwb-postgresql:5432\/japan_wikibase_query$/u.test(url??''))throw new Error('fixed standalone JWB PostgreSQL URL is required');
if(target!=='gen-b')throw new Error('only fixed gen-b promotion is supported');
const pool=new pg.Pool({connectionString:url,max:2});
try{
  const sync=await pool.query("SELECT state,schema_state FROM rdf_generation_sync WHERE source_identity=$1 AND generation_id='gen-b'",[identities.sourceIdentity]);
  if(sync.rowCount!==1||sync.rows[0].state!=='CURRENT'||sync.rows[0].schema_state!=='CURRENT')throw new Error('candidate synchronization is not current');
  const repository=new PostgresServingPointerRepository({pool,queryServiceId:identities.queryServiceId}),current=await repository.get();
  if(current.generationId==='gen-b'){process.stdout.write(`${JSON.stringify({generationId:'gen-b',version:current.version,idempotent:true})}\n`);}
  else{
    if(current.generationId!=='gen-a')throw new Error('unexpected serving generation');
    const promoted=await repository.promote({generationId:'gen-b',expectedGenerationId:'gen-a',expectedVersion:current.version,promotionId:randomUUID()});
    process.stdout.write(`${JSON.stringify({generationId:promoted.generationId,previousGenerationId:promoted.previousGenerationId,version:promoted.version,idempotent:false})}\n`);
  }
}finally{await pool.end();}
