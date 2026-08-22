export class StandaloneRuntimeProvider{
  constructor({pool,backendType,queryServiceId='jwb-standalone-query'}){if(!pool||!['virtuoso','fuseki-tdb2','oxigraph'].includes(backendType)||!/^(?:jwb-standalone-query|custom-wikibase-query-[0-9a-f-]{36})$/u.test(queryServiceId))throw new Error('INVALID_RUNTIME_PROVIDER');this.pool=pool;this.backendType=backendType;this.queryServiceId=queryServiceId;}
  async observe(){const result=await this.pool.query('SELECT p.generation_id,s.state,s.schema_state,s.catchup_cursor_timestamp,s.catchup_cursor_rcid,src.ingestion_cursor_timestamp,src.ingestion_cursor_rcid,src.status source_status FROM rdf_serving_pointer p JOIN rdf_generation_sync s ON s.source_identity=p.source_identity AND s.generation_id=p.generation_id JOIN rdf_sync_source src ON src.source_identity=p.source_identity WHERE p.query_service_id=$1',[this.queryServiceId]);if(result.rowCount!==1)throw new Error('STANDALONE_RUNTIME_STATE_MISSING');return runtimeObservation(result.rows[0]);}
}

export function runtimeObservation(row,{now=Date.now()}={}){
  const indexed=cursor(row.catchup_cursor_timestamp,row.catchup_cursor_rcid),head=cursor(row.ingestion_cursor_timestamp,row.ingestion_cursor_rcid),caughtUp=!head||compare(indexed,head)>=0,syncLagSeconds=caughtUp?0:indexed?Math.max(0,Math.floor((head.time-indexed.time)/1000)):Math.max(0,Math.floor((now-head.time)/1000)),sourceIdleSeconds=head?Math.max(0,Math.floor((now-head.time)/1000)):null;
  const consistentCurrent=row.state==='CURRENT'&&row.schema_state==='CURRENT'&&caughtUp;
  const syncState=consistentCurrent?'CURRENT':row.state==='ERROR'||row.state==='GAP_DETECTED'?row.state:'STALE';
  return Object.freeze({queryEnabled:true,syncState,schemaState:row.schema_state,sourceStatus:row.source_status,servingGeneration:row.generation_id,freshness:Object.freeze({cursorTimestamp:indexed?.iso??null,sourceHeadTimestamp:head?.iso??null,lagSeconds:syncLagSeconds,syncLagSeconds,sourceIdleSeconds})});
}
function cursor(timestamp,rcid){if(!timestamp)return null;const date=new Date(timestamp);return{time:date.getTime(),iso:date.toISOString(),rcid:Number(rcid)};}
function compare(a,b){if(!a)return-1;if(a.time!==b.time)return a.time-b.time;return a.rcid-b.rcid;}
