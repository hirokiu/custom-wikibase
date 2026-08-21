import { validateGenerationId } from '../../../packages/rdf-sync/src/generation.js';
import { SparqlHttpBackend } from '../../rdf-backends/src/sparql-http-backend.js';
import { RDF_BACKEND_PROFILES } from '../../rdf-backends/src/profiles.js';

const SLOTS=Object.freeze({'gen-a':'backend-a','gen-b':'backend-b'});
const PORTS=Object.freeze({virtuoso:8890,'fuseki-tdb2':3030,oxigraph:7878});

export class StandaloneComposeGenerationBackend {
  constructor({backendType,adminPassword=undefined}){if(!PORTS[backendType])throw new Error('STANDALONE_BACKEND_NOT_ALLOWLISTED');if(backendType==='virtuoso'&&(!adminPassword||adminPassword.length<16))throw new Error('STANDALONE_BACKEND_CREDENTIAL_REQUIRED');this.backendType=backendType;this.adminPassword=adminPassword;}
  descriptor(generationId){validateGenerationId(generationId);const host=SLOTS[generationId];if(!host)throw new Error('STANDALONE_GENERATION_SLOT_NOT_ALLOWLISTED');const base=`http://${host}:${PORTS[this.backendType]}`,endpoints=this.backendType==='virtuoso'?{queryUrl:`${base}/sparql`,updateUrl:`${base}/sparql-auth`,graphStoreUrl:`${base}/sparql-graph-crud-auth`,digestAuth:{username:'dba',password:this.adminPassword}}:this.backendType==='fuseki-tdb2'?{queryUrl:`${base}/jwb/query`,updateUrl:`${base}/jwb/update`,graphStoreUrl:`${base}/jwb/data`}:{queryUrl:`${base}/query`,updateUrl:`${base}/update`,graphStoreUrl:`${base}/store`};return Object.freeze({generationId,backendType:this.backendType,service:host,endpoints:Object.freeze(endpoints)});}
  backend(generationId){return new SparqlHttpBackend({...this.descriptor(generationId).endpoints,metadata:RDF_BACKEND_PROFILES[this.backendType]});}
}
