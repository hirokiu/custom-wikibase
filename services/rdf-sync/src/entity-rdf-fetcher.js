import { EntityRdfFetcher } from '../../../packages/rdf-sync/src/protocol.js';
import { trustedMediaWikiUrl } from './trusted-mediawiki-url.js';

export class LocalRevisionAwareEntityFetcher extends EntityRdfFetcher {
  constructor({baseUrl='http://127.0.0.1:8180',canonicalPublicUrl=baseUrl,fetchImpl=fetch,maxBytes=2_000_000}={}){super();this.baseUrl=trustedMediaWikiUrl(baseUrl);this.canonicalPublicUrl=publicOrigin(canonicalPublicUrl);this.fetchImpl=fetchImpl;this.maxBytes=maxBytes;}
  async fetch(entityId,expectedRevision){
    if(!/^[QP][1-9][0-9]*$/u.test(entityId)||!Number.isInteger(expectedRevision)||expectedRevision<1)throw new Error('invalid entity fetch input');
    const evidenceUrl=new URL('/api.php',this.baseUrl);
    for(const[k,v]of Object.entries({action:'query',revids:String(expectedRevision),prop:'info',format:'json',formatversion:'2'}))evidenceUrl.searchParams.set(k,v);
    const evidenceResponse=await this.fetchImpl(evidenceUrl);
    if(!evidenceResponse.ok)throw new Error(`revision evidence HTTP ${evidenceResponse.status}`);
    const page=Object.values((await evidenceResponse.json()).query?.pages??{})[0],expectedTitle=`${entityId.startsWith('Q')?'Item':'Property'}:${entityId}`;
    if(!page||page.title!==expectedTitle||page.lastrevid<expectedRevision)throw new Error('REVISION_MISMATCH');
    const rdfUrl=new URL(`/wiki/Special:EntityData/${entityId}.nt`,this.baseUrl);rdfUrl.searchParams.set('revision',String(expectedRevision));
    let response=await this.fetchImpl(rdfUrl,{redirect:'manual'});
    if([301,302,303,307,308].includes(response.status)){
      const location=new URL(response.headers.get('location')??'',rdfUrl);
      if(!trustedEntityRedirect(location,this.canonicalPublicUrl,{entityId,expectedRevision}))throw new Error('ENTITY_RDF_REDIRECT_UNTRUSTED');
      location.protocol=this.baseUrl.protocol;location.hostname=this.baseUrl.hostname;location.port=this.baseUrl.port;
      response=await this.fetchImpl(location,{redirect:'error'});
    }
    if(!response.ok)throw new Error(response.status===404?'ENTITY_MISSING':`EntityData HTTP ${response.status}`);
    const length=Number(response.headers.get('content-length')??0);if(length>this.maxBytes)throw new Error('ENTITY_RDF_TOO_LARGE');
    const rdf=await response.text();if(Buffer.byteLength(rdf)>this.maxBytes)throw new Error('ENTITY_RDF_TOO_LARGE');
    if(!rdf.includes(`/entity/${entityId}>`)||!rdf.includes(`<http://schema.org/version> "${expectedRevision}"`))throw new Error('REVISION_EVIDENCE_MISSING');
    return {entityId,revision:expectedRevision,rdf,mediaType:'application/n-triples'};
  }
}
function publicOrigin(value){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('canonical public URL must be an HTTP origin');return url;}
function trustedEntityRedirect(location,canonical,{entityId,expectedRevision}){
  if(location.origin!==canonical.origin||location.username||location.password||location.hash)return false;
  if(location.pathname===`/wiki/Special:EntityData/${entityId}.nt`)return location.search===`?revision=${expectedRevision}`;
  if(location.pathname!=='/index.php'||location.searchParams.size!==2||location.searchParams.get('revision')!==String(expectedRevision))return false;
  const title=location.searchParams.get('title')??'';
  return new RegExp(`^[^/]+/${entityId}\\.nt$`,'u').test(title);
}
