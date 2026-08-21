#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import * as k8s from "@kubernetes/client-node";
import { normalizeWikibaseRdf } from "../packages/rdf-sync/src/canonical-rdf-normalizer.js";
import { partitionWikibaseSnapshot, datasetToNQuads } from "../packages/rdf-sync/src/dataset-partition.js";

const CLUSTER="wfp-jwb-m10", CONTEXT=`k3d-${CLUSTER}`,
  KUBECONFIG="/tmp/wfp-jwb-m10-kubeconfig.yaml", INSTANCE="jwb-instance-local-01",
  K3D=existsSync("/tmp/wfp-tools/k3d")?"/tmp/wfp-tools/k3d":"k3d",
  action=process.argv[2];
if(!new Set(["source","qualify-source","destroy"]).has(action)) throw new Error("usage: jwb-m10b source|qualify-source|destroy");
if(action==="destroy") run("node",["scripts/jwb-m10.mjs","destroy"]);
else if(action==="source") await deploySource();
else await qualifySource();

async function deploySource(){
  assertCluster();
  const image=inspectImage("wfp/japan-wikibase:m1");
  if(image.architecture!=="arm64") throw new Error(`M10B safety guard: source image is ${image.architecture}`);
  run("docker",["tag","wfp/japan-wikibase:m1","wfp/japan-wikibase:m10b"]);
  run(K3D,["image","import","wfp/japan-wikibase:m10b","--cluster",CLUSTER]);
  const core=kube().makeApiClient(k8s.CoreV1Api),dbPassword=randomBytes(24).toString("base64url"),rootPassword=randomBytes(24).toString("base64url"),adminPassword=randomBytes(24).toString("base64url"),secretKey=randomBytes(48).toString("base64url"),upgradeKey=randomBytes(24).toString("base64url");
  await createSecret(core,INSTANCE,"jwb-mariadb",{
    MARIADB_DATABASE:"jwb",MARIADB_USER:"jwb",MARIADB_PASSWORD:dbPassword,MARIADB_ROOT_PASSWORD:rootPassword,
  });
  await createSecret(core,INSTANCE,"japan-wikibase",{
    JWB_DB_HOST:"mariadb",JWB_DB_NAME:"jwb",JWB_DB_USER:"jwb",JWB_DB_PASSWORD:dbPassword,
    JWB_ADMIN_USER:"M10BAdmin",JWB_ADMIN_PASSWORD:adminPassword,JWB_SECRET_KEY:secretKey,JWB_UPGRADE_KEY:upgradeKey,
    JWB_PUBLIC_URL:"http://japan-wikibase.jwb-instance-local-01.svc.cluster.local",JWB_SITE_NAME:"Japan Wikibase M10B",
  });
  await createSecret(core,INSTANCE,"jwb-m10b-qualification",{adminUser:"M10BAdmin",adminPassword});
  run("kubectl",[...base(),"apply","-f","infrastructure/japan-wikibase/kubernetes/m10b-source.yaml"]);
  run("kubectl",[...base(),"-n",INSTANCE,"rollout","status","statefulset/jwb-mariadb","--timeout=300s"]);
  run("kubectl",[...base(),"-n",INSTANCE,"rollout","status","deployment/japan-wikibase","--timeout=600s"]);
  run("kubectl",[...base(),"-n",INSTANCE,"rollout","status","deployment/jwb-job-runner","--timeout=300s"]);
  const nodes=unwrap(await core.listNode()).items.map(n=>({name:n.metadata.name,architecture:n.status.nodeInfo.architecture}));
  console.log(JSON.stringify({status:"M10B_REAL_SOURCE_READY",image,nodes,namespace:INSTANCE},null,2));
}

async function qualifySource(){
  assertCluster(); const config=kube(),core=config.makeApiClient(k8s.CoreV1Api),secret=unwrap(await core.readNamespacedSecret({namespace:INSTANCE,name:"jwb-m10b-qualification"})),credentials={adminUser:decode(secret.data.adminUser),adminPassword:decode(secret.data.adminPassword)},pod=await readyPod(core,"app.kubernetes.io/name=japan-wikibase"),pvcBefore=await pvcEvidence(core);let forward=startWikibaseForward();
  try{
    await waitHttp("http://127.0.0.1:28180/api.php?action=query&meta=siteinfo&format=json");
    const manifest=await createDataset(credentials),before=await entity(manifest.subjectItem);
    await core.deleteNamespacedPod({namespace:INSTANCE,name:pod.metadata.name}); await readyPod(core,"app.kubernetes.io/name=japan-wikibase"); forward.kill("SIGTERM"); forward=startWikibaseForward(); await waitHttp("http://127.0.0.1:28180/api.php?action=query&meta=siteinfo&format=json");
    assert.equal((await entity(manifest.subjectItem)).entities[manifest.subjectItem].id,before.entities[manifest.subjectItem].id);
    const maria=await readyPod(core,"app.kubernetes.io/name=jwb-mariadb"); await core.deleteNamespacedPod({namespace:INSTANCE,name:maria.metadata.name}); await readyPod(core,"app.kubernetes.io/name=jwb-mariadb"); await waitHttp("http://127.0.0.1:28180/api.php?action=query&meta=siteinfo&format=json");
    assert.equal((await entity(manifest.subjectItem)).entities[manifest.subjectItem].id,manifest.subjectItem);
    const current=await readyPod(core,"app.kubernetes.io/name=japan-wikibase"),rdf=capture("kubectl",[...base(),"-n",INSTANCE,"exec",current.metadata.name,"--","php","extensions/Wikibase/repo/maintenance/dumpRdf.php","--format","nt","--flavor","full-dump"]),normalized=normalizeWikibaseRdf(rdf,{sourceKind:"FULL_DUMP"}),dataset=partitionWikibaseSnapshot(normalized.rdf),nquads=datasetToNQuads(dataset),defaultTriples=0;
    assert.ok(nquads.includes(`/${manifest.subjectItem}>`)||nquads.includes(`:${manifest.subjectItem}>`)); assert.equal(defaultTriples,0);
    const pvcAfter=await pvcEvidence(core),images=unwrap(await core.listNamespacedPod({namespace:INSTANCE})).items.map(p=>({pod:p.metadata.name,images:(p.status.containerStatuses??[]).map(c=>({image:c.image,imageID:c.imageID}))}));
    const evidence={status:"M10B_REAL_SOURCE_QUALIFIED",manifest,persistence:{wikibasePodRecreated:true,mariaDbPodRecreated:true,samePvcs:JSON.stringify(pvcBefore)===JSON.stringify(pvcAfter),pvcs:pvcAfter},rdf:{bytes:Buffer.byteLength(rdf),namedGraphs:dataset.graphs.size,defaultGraphTriples:defaultTriples,normalizationModel:"jwb-rdf-normalization-v1",partitionModel:"jwb-partition-v1"},images};
    writeFileSync("/tmp/wfp-jwb-m10b-source-evidence.json",`${JSON.stringify(evidence,null,2)}\n`,{mode:0o600}); chmodSync("/tmp/wfp-jwb-m10b-source-evidence.json",0o600); console.log(JSON.stringify(evidence,null,2));
  } finally { forward.kill("SIGTERM"); }
}

async function createDataset(credentials){const session=await login(credentials),datasetRunId=String(Date.now()),suffix=` ${datasetRunId}`,properties={};for(const[key,datatype,ja,en]of[["string","string","M10B 文字列","M10B string"],["externalId","external-id","M10B 外部ID","M10B external ID"],["quantity","quantity","M10B 数量","M10B quantity"],["time","time","M10B 日時","M10B time"],["item","wikibase-item","M10B 項目","M10B item"],["qualifier","string","M10B 修飾子","M10B qualifier"],["reference","url","M10B 出典URL","M10B reference URL"]])properties[key]=await createEntity(session,"property",{datatype,labels:terms(`${ja}${suffix}`,`${en}${suffix}`)});const relatedItem=await createEntity(session,"item",{labels:terms(`M10B 関連項目${suffix}`,`M10B related item${suffix}`)}),claims={};claims[properties.string]=[statement(properties.string,"string",stringValue("M10B direct value"),{qualifiers:{[properties.qualifier]:[snak(properties.qualifier,"string",stringValue("qualified"))]},references:[{snaks:{[properties.reference]:[snak(properties.reference,"url",stringValue("https://example.invalid/m10b-source"))]},"snaks-order":[properties.reference]}]})];claims[properties.externalId]=[statement(properties.externalId,"external-id",stringValue("JWB-M10B-001"))];claims[properties.quantity]=[statement(properties.quantity,"quantity",{value:{amount:"+42",unit:"1"},type:"quantity"})];claims[properties.time]=[statement(properties.time,"time",{value:{time:"+2026-08-20T00:00:00Z",timezone:0,before:0,after:0,precision:11,calendarmodel:"http://www.wikidata.org/entity/Q1985727"},type:"time"})];claims[properties.item]=[statement(properties.item,"wikibase-item",{value:{"entity-type":"item","numeric-id":Number(relatedItem.slice(1)),id:relatedItem},type:"wikibase-entityid"})];const subjectItem=await createEntity(session,"item",{labels:terms(`M10B Kubernetes 項目${suffix}`,`M10B Kubernetes item${suffix}`),descriptions:terms("Kubernetes 同期試験用","Kubernetes synchronization fixture"),aliases:{ja:[{language:"ja",value:`M10B 試験項目${suffix}`}],en:[{language:"en",value:`M10B test item${suffix}`}]},claims}),deleteItem=await createEntity(session,"item",{labels:terms(`M10B 削除復元用${suffix}`,`M10B delete restore${suffix}`)});return{version:1,datasetRunId,subjectItem,relatedItem,deleteItem,properties};}
function terms(ja,en){return{ja:{language:"ja",value:ja},en:{language:"en",value:en}};}function stringValue(value){return{value,type:"string"};}function snak(property,datatype,datavalue){return{snaktype:"value",property,datatype,datavalue};}function statement(property,datatype,datavalue,extra={}){return{type:"statement",rank:"normal",mainsnak:snak(property,datatype,datavalue),...extra};}
async function login(c){let r=await api({action:"query",meta:"tokens",type:"login"});r=await api({action:"login",lgname:c.adminUser,lgpassword:c.adminPassword,lgtoken:r.data.query.tokens.logintoken},r.cookie,true);if(r.data.login?.result!=="Success")throw new Error("M10B login failed");const csrf=await api({action:"query",meta:"tokens"},r.cookie);return{cookie:csrf.cookie,token:csrf.data.query.tokens.csrftoken};}
async function createEntity(session,kind,data){const r=await api({action:"wbeditentity",new:kind,token:session.token,data:JSON.stringify(data),summary:"M10B local Kubernetes fixture"},session.cookie,true),id=r.data.entity?.id;if(!/^[QP][1-9][0-9]*$/u.test(id))throw new Error(`entity creation failed: ${JSON.stringify(r.data.error??r.data)}`);return id;}
async function entity(id){return(await api({action:"wbgetentities",ids:id})).data;}
async function api(parameters,cookie="",post=false){const values={format:"json",formatversion:"2",...parameters},response=post?await fetch("http://127.0.0.1:28180/api.php",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",cookie},body:new URLSearchParams(values)}):await fetch(`http://127.0.0.1:28180/api.php?${new URLSearchParams(values)}`,{headers:cookie?{cookie}:{}});if(!response.ok)throw new Error(`MediaWiki HTTP ${response.status}`);const cookies=new Map(cookie.split("; ").filter(Boolean).map(v=>[v.split("=",1)[0],v]));for(const value of response.headers.getSetCookie?.()??[]){const pair=value.split(";",1)[0];cookies.set(pair.split("=",1)[0],pair);}return{data:await response.json(),cookie:[...cookies.values()].join("; ")};}
async function pvcEvidence(core){const values=unwrap(await core.listNamespacedPersistentVolumeClaim({namespace:INSTANCE})).items;return values.map(v=>({name:v.metadata.name,uid:v.metadata.uid,phase:v.status.phase,requested:v.spec.resources.requests.storage})).sort((a,b)=>a.name.localeCompare(b.name));}
async function readyPod(core,selector){for(let i=0;i<600;i++){const pods=unwrap(await core.listNamespacedPod({namespace:INSTANCE,labelSelector:selector})).items??[],ready=pods.find(p=>!p.metadata.deletionTimestamp&&p.status.conditions?.some(c=>c.type==="Ready"&&c.status==="True"));if(ready)return ready;await sleep(500);}throw new Error(`ready Pod timeout: ${selector}`);}
async function createSecret(core,namespace,name,values){const body={metadata:{name,namespace,labels:{"wikibase-federation.lodac.nii.ac.jp/environment":"local"}},type:"Opaque",data:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,Buffer.from(v).toString("base64")]))};try{await core.createNamespacedSecret({namespace,body});}catch(error){if(status(error)!==409)throw error;}}
async function waitHttp(url){for(let i=0;i<600;i++){try{if((await fetch(url)).ok)return;}catch{}await sleep(500);}throw new Error("HTTP timeout");}
function inspectImage(name){const v=JSON.parse(capture("docker",["image","inspect",name]))[0];return{requested:name,architecture:v.Architecture,imageId:v.Id,repoDigests:v.RepoDigests??[]};}
function startWikibaseForward(){return spawn("kubectl",[...base(),"-n",INSTANCE,"port-forward","service/japan-wikibase","28180:80"],{stdio:"ignore"});}
function assertCluster(){if(!existsSync(KUBECONFIG))throw new Error("M10B safety guard: dedicated kubeconfig missing");const context=capture("kubectl",[...base(),"config","current-context"]).trim(),server=capture("kubectl",[...base(),"config","view","--minify","-o","jsonpath={.clusters[0].cluster.server}"]).trim();if(context!==CONTEXT||!/^https:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):\d+$/u.test(server)||/utirik|prod/iu.test(server))throw new Error(`M10B safety guard rejected ${context} ${server}`);}
function kube(){assertCluster();const k=new k8s.KubeConfig();k.loadFromFile(KUBECONFIG);k.setCurrentContext(CONTEXT);return k;}function base(){return["--kubeconfig",KUBECONFIG,"--context",CONTEXT];}function capture(command,args){return execFileSync(command,args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]});}function run(command,args){execFileSync(command,args,{stdio:"inherit"});}function decode(v){return Buffer.from(v,"base64").toString();}function unwrap(v){return v?.body??v;}function status(e){return e?.statusCode??e?.response?.statusCode??e?.code;}function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
