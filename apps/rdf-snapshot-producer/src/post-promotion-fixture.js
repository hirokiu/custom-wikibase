#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { validateSemanticFixtureManifest } from '../../../packages/rdf-sync/src/semantic-fixture-manifest.js';

const base=trustedUrl(process.env.JWB_FIXTURE_SOURCE_URL),adminUser=process.env.JWB_ADMIN_USER,adminPassword=process.env.JWB_ADMIN_PASSWORD;
if(!adminUser||!adminPassword)throw new Error('JWB_POST_PROMOTION_CREDENTIALS_REQUIRED');
const manifest=validateSemanticFixtureManifest(JSON.parse(await readFile('/artifacts/semantic-fixture.json','utf8'))),session=await login(),stamp=new Date().toISOString();
const itemEdit=await edit(manifest.subjectItem,{descriptions:{ja:{language:'ja',value:`昇格後更新 ${stamp}`},en:{language:'en',value:`post-promotion update ${stamp}`}}},'U1-B bounded post-promotion item edit');
const propertyEdit=await edit(manifest.properties.string,{descriptions:{ja:{language:'ja',value:`昇格後プロパティ更新 ${stamp}`},en:{language:'en',value:`post-promotion property update ${stamp}`}}},'U1-B bounded post-promotion property edit');
const targetTitle=entityTitle(manifest.targetItem);
await mutate({action:'delete',title:targetTitle,token:session.token,reason:'U1-B bounded deletion qualification',watchlist:'nochange'},'JWB_POST_PROMOTION_DELETE_FAILED');
await mutate({action:'undelete',title:targetTitle,token:session.token,reason:'U1-B bounded restoration qualification',watchlist:'nochange'},'JWB_POST_PROMOTION_UNDELETE_FAILED');
const restored=await api({action:'wbgetentities',ids:manifest.targetItem,props:'info'}),restoredRevision=Number(restored.data.entities?.[manifest.targetItem]?.lastrevid);
if(!Number.isInteger(restoredRevision)||restoredRevision<1||restored.data.entities?.[manifest.targetItem]?.missing!==undefined)throw new Error('JWB_POST_PROMOTION_RESTORE_NOT_VISIBLE');
process.stdout.write(`${JSON.stringify({subjectItem:manifest.subjectItem,itemRevision:itemEdit,propertyId:manifest.properties.string,propertyRevision:propertyEdit,deletedAndRestoredItem:manifest.targetItem,restoredRevision})}\n`);

async function edit(id,data,summary){const result=await mutate({action:'wbeditentity',id,token:session.token,data:JSON.stringify(data),summary},'JWB_POST_PROMOTION_EDIT_FAILED'),revision=Number(result.entity?.lastrevid);if(!Number.isInteger(revision)||revision<1)throw new Error('JWB_POST_PROMOTION_REVISION_INVALID');return revision;}
async function mutate(parameters,errorCode){const result=(await api(parameters,session.cookie,true)).data;if(result.error)throw new Error(`${errorCode}:${result.error.code??'unknown'}`);return result;}
async function login(){let r=await api({action:'query',meta:'tokens',type:'login'});r=await api({action:'login',lgname:adminUser,lgpassword:adminPassword,lgtoken:r.data.query.tokens.logintoken},r.cookie,true);if(r.data.login?.result!=='Success')throw new Error('JWB_POST_PROMOTION_LOGIN_FAILED');const csrf=await api({action:'query',meta:'tokens'},r.cookie);return{cookie:csrf.cookie,token:csrf.data.query.tokens.csrftoken};}
async function api(parameters,cookie='',post=false){const values={format:'json',formatversion:'2',...parameters},response=post?await fetch(`${base}/api.php`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',cookie},body:new URLSearchParams(values)}):await fetch(`${base}/api.php?${new URLSearchParams(values)}`,{headers:cookie?{cookie}:{}});if(!response.ok)throw new Error(`JWB_POST_PROMOTION_HTTP_${response.status}`);const cookies=new Map(cookie.split('; ').filter(Boolean).map(v=>[v.split('=',1)[0],v]));for(const value of response.headers.getSetCookie?.()??[]){const pair=value.split(';',1)[0];cookies.set(pair.split('=',1)[0],pair);}return{data:await response.json(),cookie:[...cookies.values()].join('; ')};}
function entityTitle(id){if(/^Q[1-9][0-9]*$/u.test(id))return`Item:${id}`;if(/^P[1-9][0-9]*$/u.test(id))return`Property:${id}`;throw new Error('JWB_POST_PROMOTION_ENTITY_ID_INVALID');}
function trustedUrl(value){const url=new URL(value??'');if(url.protocol!=='http:'||!/^wikibase(?:\.[a-z0-9-]+\.svc\.cluster\.local)?$/u.test(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('JWB_FIXTURE_SOURCE_URL_INVALID');return url.toString().replace(/\/$/u,'');}
