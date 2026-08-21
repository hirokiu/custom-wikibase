const rootKeys=['contractVersion','distribution','instance','endpoints','health','queryService','capabilities'];
const backendTypes=new Set(['virtuoso','fuseki-tdb2','oxigraph']);
const syncStates=new Set(['BOOTSTRAPPING','CATCHING_UP','CURRENT','STALE','GAP_DETECTED','ERROR']);
const healthStates=new Set(['healthy','degraded','unhealthy','unknown']);

export function validateJwbRuntimeV1(value){
  object(value,'contract');exact(value,rootKeys,'contract');
  if(value.contractVersion!=='jwb-runtime-v1')fail('contractVersion');
  object(value.distribution,'distribution');exact(value.distribution,['type','version'],'distribution');
  if(value.distribution.type!=='japan-wikibase'||!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u.test(value.distribution.version))fail('distribution');
  object(value.instance,'instance');exact(value.instance,['id'],'instance');
  if(!uuid(value.instance.id))fail('instance.id');
  object(value.endpoints,'endpoints');exact(value.endpoints,['mediawiki','actionApi'],'endpoints');
  endpoint(value.endpoints.mediawiki,'endpoints.mediawiki');endpoint(value.endpoints.actionApi,'endpoints.actionApi');
  object(value.health,'health');exact(value.health,['state'],'health');if(!healthStates.has(value.health.state))fail('health.state');
  query(value.queryService);
  object(value.capabilities,'capabilities');exact(value.capabilities,['queryOptional','instanceStopPreservesData'],'capabilities');
  if(value.capabilities.queryOptional!==true||typeof value.capabilities.instanceStopPreservesData!=='boolean')fail('capabilities');
  return Object.freeze(value);
}

function query(value){object(value,'queryService');if(value.enabled===false){exact(value,['enabled'],'queryService');return;}if(value.enabled!==true)fail('queryService.enabled');exact(value,['enabled','backendType','logicalEndpoint','syncState','freshness','servingGeneration'],'queryService');if(!backendTypes.has(value.backendType))fail('queryService.backendType');endpoint(value.logicalEndpoint,'queryService.logicalEndpoint');if(!syncStates.has(value.syncState))fail('queryService.syncState');object(value.freshness,'queryService.freshness');exact(value.freshness,['cursorTimestamp','sourceHeadTimestamp','lagSeconds','syncLagSeconds','sourceIdleSeconds'],'queryService.freshness');if(!seconds(value.freshness.lagSeconds)||value.freshness.lagSeconds!==value.freshness.syncLagSeconds||!seconds(value.freshness.syncLagSeconds)||!nullableSeconds(value.freshness.sourceIdleSeconds)||!nullableDate(value.freshness.cursorTimestamp)||!nullableDate(value.freshness.sourceHeadTimestamp))fail('queryService.freshness');if(!/^gen-[a-z0-9][a-z0-9-]{0,58}$/u.test(value.servingGeneration))fail('queryService.servingGeneration');}
function seconds(value){return Number.isInteger(value)&&value>=0;}function nullableSeconds(value){return value===null||seconds(value);}function nullableDate(value){return value===null||!Number.isNaN(Date.parse(value));}
function endpoint(value,path){try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail(path);}catch{fail(path);}}
function object(value,path){if(!value||typeof value!=='object'||Array.isArray(value))fail(path);}
function exact(value,keys,path){const actual=Object.keys(value);if(actual.length!==keys.length||actual.some(key=>!keys.includes(key)))fail(`${path}.unexpected-or-missing-field`);}
function uuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value??'');}
function fail(path){throw new Error(`JWB_RUNTIME_V1_INVALID:${path}`);}
