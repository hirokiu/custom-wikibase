import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateJwbRuntimeV1} from './validate.js';

const schema=JSON.parse(readFileSync(new URL('../jwb-runtime-v1.schema.json',import.meta.url),'utf8'));
const freshnessSchema=schema.properties.queryService.oneOf[1].properties.freshness;
const required=['cursorTimestamp','sourceHeadTimestamp','lagSeconds','syncLagSeconds','sourceIdleSeconds'];
const base=()=>({contractVersion:'jwb-runtime-v1',distribution:{type:'japan-wikibase',version:'0.1.0-rc.1'},instance:{id:'00000000-0000-4000-8000-000000000001'},endpoints:{mediawiki:'https://wiki.example.test/wiki/',actionApi:'https://wiki.example.test/api.php'},health:{state:'healthy'},queryService:{enabled:true,backendType:'virtuoso',logicalEndpoint:'https://query.example.test/sparql',syncState:'CURRENT',freshness:{cursorTimestamp:'2026-08-20T00:00:00.000Z',sourceHeadTimestamp:'2026-08-20T00:00:00.000Z',lagSeconds:0,syncLagSeconds:0,sourceIdleSeconds:600},servingGeneration:'gen-b'},capabilities:{queryOptional:true,instanceStopPreservesData:true}});

test('canonical schema declares the executable freshness shape',()=>{
  assert.deepEqual(freshnessSchema.required,required);
  assert.deepEqual(Object.keys(freshnessSchema.properties),required);
  assert.equal(freshnessSchema.additionalProperties,false);
  assert.deepEqual(freshnessSchema.properties.cursorTimestamp.type,['string','null']);
  assert.deepEqual(freshnessSchema.properties.sourceHeadTimestamp.type,['string','null']);
  assert.deepEqual(freshnessSchema.properties.sourceIdleSeconds.type,['integer','null']);
});

test('canonical schema shape and executable validator agree on freshness fixtures',()=>{
  const fixtures=[
    base(),
    change(value=>{value.queryService.freshness.cursorTimestamp=null;value.queryService.freshness.sourceHeadTimestamp=null;value.queryService.freshness.sourceIdleSeconds=null;}),
    ...required.map(key=>change(value=>{delete value.queryService.freshness[key];})),
    change(value=>{value.queryService.freshness.unpublished=1;}),
    change(value=>{value.queryService.freshness.lagSeconds=-1;value.queryService.freshness.syncLagSeconds=-1;}),
    change(value=>{value.queryService.freshness.sourceIdleSeconds=-1;}),
    change(value=>{value.queryService.freshness.cursorTimestamp='not-a-date';})
  ];
  for(const fixture of fixtures)assert.equal(schemaAcceptsFreshness(fixture.queryService.freshness),executableAccepts(fixture));
});

function change(mutate){const value=base();mutate(value);return value;}
function executableAccepts(value){try{validateJwbRuntimeV1(value);return true;}catch{return false;}}
function schemaAcceptsFreshness(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  if(Object.keys(value).some(key=>!required.includes(key))||required.some(key=>!(key in value)))return false;
  for(const key of ['lagSeconds','syncLagSeconds'])if(!Number.isInteger(value[key])||value[key]<0)return false;
  if(value.sourceIdleSeconds!==null&&(!Number.isInteger(value.sourceIdleSeconds)||value.sourceIdleSeconds<0))return false;
  for(const key of ['cursorTimestamp','sourceHeadTimestamp'])if(value[key]!==null&&(typeof value[key]!=='string'||Number.isNaN(Date.parse(value[key]))))return false;
  return value.lagSeconds===value.syncLagSeconds;
}
