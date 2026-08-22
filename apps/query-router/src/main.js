#!/usr/bin/env node
import pg from 'pg';
import { PostgresServingPointerRepository } from '../../../services/rdf-sync/src/postgres-serving-pointer-repository.js';
import { RouterMetrics } from './metrics.js';
import { QueryRouter } from './router.js';
import { createQueryRouterServer } from './server.js';
import { loadRouterConfig } from './config.js';
import { PostgresGenerationDescriptorRepository, TrustedGenerationResolver } from './generation-resolver.js';
import { StandaloneRuntimeProvider } from '../../../services/rdf-sync/src/standalone-runtime-provider.js';

const config = loadRouterConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3, connectionTimeoutMillis: 5000 });
pool.on('error', () => {});
const pointerRepository = new PostgresServingPointerRepository({ pool, queryServiceId: config.queryServiceId });
const generationResolver = new TrustedGenerationResolver({ generationRepository: new PostgresGenerationDescriptorRepository({ pool }), runtimeType: config.runtimeType });
const metrics = new RouterMetrics();
const router = new QueryRouter({ pointerRepository, generationResolver, metrics });
const instanceId=process.env.JWB_INSTANCE_ID;
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(instanceId??''))throw new Error('invalid standalone instance identity');
const observationProvider=new StandaloneRuntimeProvider({pool,backendType:config.backendType,queryServiceId:config.queryServiceId});
const runtimeProvider=async()=>{const observation=await observationProvider.observe(),syncState=observation.syncState;return{contractVersion:'jwb-runtime-v1',distribution:{type:'japan-wikibase',version:'0.1.0-rc.1'},instance:{id:instanceId},endpoints:{mediawiki:`${config.canonicalPublicUrl}/wiki/`,actionApi:`${config.canonicalPublicUrl}/api.php`},health:{state:syncState==='CURRENT'?'healthy':syncState==='ERROR'||syncState==='GAP_DETECTED'?'unhealthy':'degraded'},queryService:{enabled:true,backendType:config.backendType,logicalEndpoint:config.publicQueryUrl,syncState,freshness:observation.freshness,servingGeneration:observation.servingGeneration},capabilities:{queryOptional:true,instanceStopPreservesData:true}};};
const server = createQueryRouterServer({ router, metrics,runtimeProvider, port: config.port,host:config.runtimeType==='compose'?'127.0.0.1':'0.0.0.0' });
await server.start();
process.stdout.write(JSON.stringify({ event: 'query_router_started', port: config.port, queryServiceId: config.queryServiceId }) + '\n');
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await server.close(); await pool.end(); }
process.on('SIGTERM', () => { stop().then(() => process.exit(0), () => process.exit(1)); });
process.on('SIGINT', () => { stop().then(() => process.exit(0), () => process.exit(1)); });
