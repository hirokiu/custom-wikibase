#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWB_BASE_URL, JWB_STATE_FILE, stateEnvironment } from './jwb-lib.mjs';

if (!existsSync(JWB_STATE_FILE)) throw new Error('run npm run jwb:create first');
const state=JSON.parse(readFileSync(JWB_STATE_FILE,'utf8')); stateEnvironment(state);
if(new URL(JWB_BASE_URL).hostname!=='127.0.0.1') throw new Error('M4 lifecycle experiment is local only');
const outputDirectory=new URL('../artifacts/jwb-m4/',import.meta.url).pathname;mkdirSync(outputDirectory,{recursive:true});
const auth=await login();const startedAt=new Date(Date.now()-1000).toISOString();
const result={version:1,startedAt,source:JWB_BASE_URL,entities:{},revisionFetch:{},lifecycle:{},recentChanges:[]};

const lifecycle=await create('item','M4 削除復元');result.entities.lifecycle=lifecycle.id;
result.revisionFetch.created=await revisionEvidence(lifecycle.id,lifecycle.revision);
const edited=await post({action:'wbsetlabel',id:lifecycle.id,language:'ja',value:'M4 削除復元 改訂'});
const editedRevision=revisionOf(edited);result.revisionFetch.historicalAfterEdit=await revisionEvidence(lifecycle.id,lifecycle.revision);
result.revisionFetch.currentAfterEdit=await revisionEvidence(lifecycle.id,editedRevision);
const title=`Item:${lifecycle.id}`;
result.lifecycle.delete=await attempted('delete',()=>post({action:'delete',title,reason:'M4 local lifecycle test'}));
result.lifecycle.afterDelete=await entityState(lifecycle.id);
result.lifecycle.undelete=await attempted('undelete',()=>post({action:'undelete',title,reason:'M4 local lifecycle test'}));
result.lifecycle.afterUndelete=await entityState(lifecycle.id);

const redirectFrom=await create('item','M4 redirect source'),redirectTo=await create('item','M4 redirect target');
result.entities.redirect={from:redirectFrom.id,to:redirectTo.id};
result.lifecycle.redirect=await attempted('wbcreateredirect',()=>post({action:'wbcreateredirect',from:redirectFrom.id,to:redirectTo.id}));
result.lifecycle.afterRedirect=await entityState(redirectFrom.id);
result.lifecycle.redirectRemoval=await attempted('delete redirect',()=>post({action:'delete',title:`Item:${redirectFrom.id}`,reason:'M4 local redirect removal'}));
result.lifecycle.afterRedirectRemoval=await entityState(redirectFrom.id);

const mergeFrom=await create('item','M4 merge source'),mergeTo=await create('item','M4 merge target');
result.entities.merge={from:mergeFrom.id,to:mergeTo.id};
result.lifecycle.merge=await attempted('wbmergeitems',()=>post({action:'wbmergeitems',fromid:mergeFrom.id,toid:mergeTo.id,ignoreconflicts:'description|sitelink'}));
result.lifecycle.afterMergeSource=await entityState(mergeFrom.id);

const property=await create('property','M4 property','string');result.entities.property=property.id;
result.lifecycle.propertyDelete=await attempted('delete property',()=>post({action:'delete',title:`Property:${property.id}`,reason:'M4 local property lifecycle'}));
result.lifecycle.propertyAfterDelete=await entityState(property.id);
const changes=await get({action:'query',list:'recentchanges',rcstart:'now',rcend:startedAt,rcdir:'older',rclimit:'100',rcnamespace:'120|122',rcprop:'title|ids|timestamp|flags|loginfo|comment|redirect'});
result.recentChanges=(changes.query?.recentchanges??[]).reverse().map(rc=>({rcid:rc.rcid,timestamp:rc.timestamp,type:rc.type,title:rc.title,revid:rc.revid??0,oldRevid:rc.old_revid??0,logtype:rc.logtype??null,logaction:rc.logaction??null,redirect:Boolean(rc.redirect)}));
result.completedAt=new Date().toISOString();write('lifecycle-observations.json',result);console.log(JSON.stringify(result,null,2));

async function create(kind,label,datatype){const data={labels:{ja:{language:'ja',value:label}}};if(datatype)data.datatype=datatype;const value=await post({action:'wbeditentity',new:kind,data:JSON.stringify(data)});return{id:value.entity.id,revision:value.entity.lastrevid};}
async function entityState(id){const api=await get({action:'wbgetentities',ids:id,props:'info|labels'});const entity=api.entities?.[id]??Object.values(api.entities??{})[0]??{};const rdf=await fetch(`${JWB_BASE_URL}/wiki/Special:EntityData/${id}.nt`);return{api:{id:entity.id??id,missing:entity.missing!==undefined,redirect:entity.redirect!==undefined,lastrevid:entity.lastrevid??null},rdf:{status:rdf.status,hasEntity:(await rdf.text()).includes(`/entity/${id}>`)}};}
async function revisionEvidence(id,revision){const api=await get({action:'query',revids:String(revision),prop:'info'});const page=Object.values(api.query?.pages??{})[0]??{};const rdf=await fetch(`${JWB_BASE_URL}/wiki/Special:EntityData/${id}.nt?revision=${revision}`);const body=await rdf.text();return{requestedRevision:revision,pageTitle:page.title??null,currentPageRevision:page.lastrevid??null,rdfStatus:rdf.status,rdfHasVersion:body.includes(`<http://schema.org/version> "${revision}"`),rdfHasEntity:body.includes(`/entity/${id}>`)};}
async function attempted(name,fn){try{const value=await fn();return{supported:true,revision:revisionOf(value),result:Object.keys(value).filter(k=>k!=='warnings')};}catch(error){return{supported:false,error:String(error.message),operation:name};}}
function revisionOf(v){return v.pageinfo?.lastrevid??v.entity?.lastrevid??v.lastrevid??null;}
async function login(){let r=await raw('GET',{action:'query',meta:'tokens',type:'login'},'');let p=await raw('POST',{action:'login',lgname:state.adminUser,lgpassword:state.adminPassword,lgtoken:r.data.query.tokens.logintoken},r.cookie);if(p.data.login?.result!=='Success')throw new Error('login failed');r=await raw('GET',{action:'query',meta:'tokens'},p.cookie);return{cookie:r.cookie,token:r.data.query.tokens.csrftoken};}
async function get(parameters){const r=await raw('GET',parameters,auth.cookie);if(r.data.error)throw new Error(`${parameters.action}: ${r.data.error.code}`);return r.data;}
async function post(parameters){const r=await raw('POST',{...parameters,token:auth.token,summary:'M4 local correctness experiment'},auth.cookie);if(r.data.error)throw new Error(`${parameters.action}: ${r.data.error.code}: ${r.data.error.info??''}`);return r.data;}
async function raw(method,parameters,cookie){const common={format:'json',formatversion:'2',...parameters};const response=method==='GET'?await fetch(`${JWB_BASE_URL}/api.php?${new URLSearchParams(common)}`,{headers:cookie?{cookie}:{}}):await fetch(`${JWB_BASE_URL}/api.php`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',...(cookie?{cookie}:{})},body:new URLSearchParams(common)});const values=new Map();for(const pair of cookie?cookie.split('; '):[])values.set(pair.split('=',1)[0],pair);for(const value of response.headers.getSetCookie?.()??[]){const pair=value.split(';',1)[0];values.set(pair.split('=',1)[0],pair);}return{data:await response.json(),cookie:[...values.values()].join('; ')};}
function write(name,value){const path=`${outputDirectory}${name}`;writeFileSync(path,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});chmodSync(path,0o600);}
