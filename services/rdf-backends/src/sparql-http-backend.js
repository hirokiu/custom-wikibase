import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { RdfBackend, validateRdfBackendMetadata } from '../../../packages/rdf-domain/src/rdf-backend.js';

const RESET_PREFIX = 'reset:';

/** HTTP implementation used by the M2 conformance profiles. */
export class SparqlHttpBackend extends RdfBackend {
  /** @param {{metadata: object, queryUrl: string, updateUrl?: string, graphStoreUrl?: string, datasetGraphIri?: string, headers?: Record<string,string>, digestAuth?: {username: string, password: string}}} options */
  constructor(options) {
    super();
    this.backendMetadata = validateRdfBackendMetadata(options.metadata);
    this.queryUrl = checkedUrl(options.queryUrl);
    this.updateUrl = options.updateUrl ? checkedUrl(options.updateUrl) : null;
    this.graphStoreUrl = options.graphStoreUrl ? checkedUrl(options.graphStoreUrl) : null;
    this.datasetGraphIri = options.datasetGraphIri ?? null;
    if (this.datasetGraphIri) requireGraphIri(this.datasetGraphIri);
    this.headers = Object.freeze({ ...(options.headers ?? {}) });
    this.digestAuth = options.digestAuth ? Object.freeze({ ...options.digestAuth }) : null;
    this.instanceId = null;
  }

  metadata() { return this.backendMetadata; }

  /** @param {{instanceId: string}} context */
  async initialize({ instanceId }) {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(instanceId)) throw new Error('invalid RDF instance identifier');
    this.instanceId = instanceId;
    return this.health();
  }

  /** @returns {Promise<{status: 'healthy'|'unhealthy', details: object}>} */
  async health() {
    try {
      const result = await this.query('ASK { ?s ?p ?o }');
      return { status: 'healthy', details: { responsive: typeof result.boolean === 'boolean' } };
    } catch (error) {
      return { status: 'unhealthy', details: { error: String(error.message) } };
    }
  }

  async query(sparql) {
    if (typeof sparql !== 'string' || sparql.length === 0) throw new Error('SPARQL query must be non-empty');
    const response = await this.request(this.queryUrl, {
      method: 'POST', headers: { accept: 'application/sparql-results+json', 'content-type': 'application/sparql-query', ...this.headers }, body: sparql
    });
    if (!response.ok) throw new Error(`SPARQL query failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return response.json();
  }

  async loadSnapshot(snapshot) { return this.replaceDataset(snapshot); }

  async replaceDataset(snapshot) {
    requireCapability(this.backendMetadata, 'graphStoreProtocol');
    await this.reset({ confirmationToken: this.resetToken() });
    return this.putGraph(snapshot, this.datasetGraphIri);
  }

  async applyEntityChange(change) {
    requireCapability(this.backendMetadata, 'namedGraphs');
    return this.replaceNamedGraph(change);
  }

  async replaceNamedGraph(graph) {
    requireCapability(this.backendMetadata, 'graphStoreProtocol');
    requireGraphIri(graph.graphIri);
    return this.putGraph(graph, graph.graphIri);
  }

  async deleteNamedGraph({ graphIri }) {
    requireCapability(this.backendMetadata, 'graphStoreProtocol');
    requireGraphIri(graphIri);
    const response = await this.request(graphUrl(this.graphStoreUrl, graphIri), { method: 'DELETE', headers: this.headers }, true);
    if (!response.ok && response.status !== 404) throw new Error(`graph delete failed with HTTP ${response.status}`);
  }

  /** @returns {{url: string, access: 'public-read'}} */
  sparqlQueryEndpoint() { return { url: this.queryUrl, access: 'public-read' }; }
  /** @returns {{url: string, access: 'internal-write'}|null} */
  internalUpdateEndpoint() { return this.updateUrl ? { url: this.updateUrl, access: 'internal-write' } : null; }

  async exportDataset({ destination, mediaType, graphIris = [] }) {
    if (mediaType !== 'application/n-triples') throw new Error('M2 export supports application/n-triples only');
    const response = await this.request(logicalDatasetUrl(this.queryUrl, graphIris), {
      method: 'POST', headers: { accept: mediaType, 'content-type': 'application/sparql-query', ...this.headers },
      body: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }'
    });
    if (!response.ok) throw new Error(`RDF export failed with HTTP ${response.status}`);
    const body = await response.text();
    await writeFile(destination, body, { mode: 0o600 });
    return { bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') };
  }

  async rebuild({ snapshot }) {
    if (!snapshot) throw new Error('rebuild requires a canonical snapshot');
    return this.replaceDataset(snapshot);
  }

  async reset({ confirmationToken }) {
    if (!this.instanceId || confirmationToken !== this.resetToken()) throw new Error('invalid reset confirmation token');
    if (this.datasetGraphIri && this.graphStoreUrl) {
      await this.deleteNamedGraph({ graphIri: this.datasetGraphIri });
      return;
    }
    requireCapability(this.backendMetadata, 'sparql11Update');
    if (!this.updateUrl) throw new Error('internal update endpoint is unavailable');
    const response = await this.request(this.updateUrl, {
      method: 'POST', headers: { 'content-type': 'application/sparql-update', ...this.headers }, body: 'CLEAR ALL'
    }, true);
    if (!response.ok) throw new Error(`dataset reset failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  resetToken() {
    if (!this.instanceId) throw new Error('backend is not initialized');
    return `${RESET_PREFIX}${this.instanceId}`;
  }

  async shutdown() {}

  async putGraph(snapshot, graphIri) {
    if (!this.graphStoreUrl) throw new Error('graph store endpoint is unavailable');
    if (snapshot.mediaType !== 'application/n-triples') throw new Error('M2 snapshot must use application/n-triples');
    const body = await readFile(snapshot.source, 'utf8');
    const response = await this.request(graphUrl(this.graphStoreUrl, graphIri), {
      method: 'PUT', headers: { 'content-type': snapshot.mediaType, ...this.headers }, body
    }, true);
    if (!response.ok) throw new Error(`graph load failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return { bytes: Buffer.byteLength(body) };
  }

  async request(url, init, authenticate = false) {
    if (!authenticate || !this.digestAuth) return boundedFetch(url, init);
    const first = await boundedFetch(url, init);
    if (first.status !== 401) return first;
    const challenge = first.headers.get('www-authenticate');
    if (!challenge?.startsWith('Digest ')) return first;
    const values = parseDigestChallenge(challenge.slice(7));
    const target = new URL(url);
    const uri = `${target.pathname}${target.search}`;
    const nc = '00000001';
    const cnonce = randomBytes(12).toString('hex');
    const ha1 = md5(`${this.digestAuth.username}:${values.realm}:${this.digestAuth.password}`);
    const ha2 = md5(`${init.method ?? 'GET'}:${uri}`);
    const response = md5(`${ha1}:${values.nonce}:${nc}:${cnonce}:auth:${ha2}`);
    const authorization = [
      `Digest username="${this.digestAuth.username}"`, `realm="${values.realm}"`, `nonce="${values.nonce}"`,
      `uri="${uri}"`, `response="${response}"`, 'qop=auth', `nc=${nc}`, `cnonce="${cnonce}"`,
      ...(values.opaque ? [`opaque="${values.opaque}"`] : [])
    ].join(', ');
    return boundedFetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization } });
  }
}

function logicalDatasetUrl(base, graphIris) {
  if (!Array.isArray(graphIris) || graphIris.length > 10_000) throw new Error('invalid logical dataset graph list');
  const url = new URL(base);
  for (const graphIri of graphIris) { requireGraphIri(graphIri); if (!graphIri.startsWith('urn:jwb:')) throw new Error('logical dataset graph is not managed'); url.searchParams.append('default-graph-uri', graphIri); }
  return url;
}

function checkedUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid RDF endpoint URL');
  return url.toString();
}

function requireCapability(metadata, name) {
  if (!metadata.capabilities[name]) throw new Error(`${metadata.backendType} does not support required capability ${name}`);
}

function requireGraphIri(value) {
  const url = new URL(value);
  if (!['http:', 'https:', 'urn:'].includes(url.protocol)) throw new Error('invalid named graph IRI');
}

function graphUrl(base, graphIri) {
  if (!base) throw new Error('graph store endpoint is unavailable');
  const url = new URL(base);
  if (graphIri) url.searchParams.set('graph', graphIri);
  else url.searchParams.set('default', '');
  return url;
}

function parseDigestChallenge(value) {
  const parsed = {};
  for (const match of value.matchAll(/([a-z]+)=(?:"([^"]*)"|([^,\s]+))/giu)) parsed[match[1].toLowerCase()] = match[2] ?? match[3];
  if (!parsed.realm || !parsed.nonce || (parsed.qop && !parsed.qop.split(',').map((item) => item.trim()).includes('auth'))) throw new Error('unsupported HTTP Digest challenge');
  return parsed;
}

function md5(value) { return createHash('md5').update(value).digest('hex'); }
async function boundedFetch(url,init){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{return await fetch(url,{...init,signal:controller.signal});}finally{clearTimeout(timer);}}
