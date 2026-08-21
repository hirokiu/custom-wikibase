export const RDF_BACKEND_TYPES = Object.freeze([
  'virtuoso',
  'fuseki-tdb2',
  'blazegraph-wdqs',
  'oxigraph',
  'qlever'
]);

export const RDF_BACKEND_CAPABILITY_NAMES = Object.freeze([
  'sparql11Query',
  'sparql11Update',
  'namedGraphs',
  'transactionalUpdate',
  'graphStoreProtocol',
  'serviceFederation',
  'fullTextSearch',
  'geoSparql',
  'wikibaseLabelService',
  'isolatedGenerations',
  'atomicServingCutover',
  'rollbackCutover',
  'generationDelete',
  'generationQuery'
]);

/**
 * Validate and freeze backend capability metadata at an integration boundary.
 * Capability values describe observed adapter behavior, not product promises.
 *
 * @param {unknown} value
 * @returns {{backendType: string, capabilities: Readonly<Record<string, boolean>>}}
 */
export function validateRdfBackendMetadata(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('RDF backend metadata must be an object');
  }

  const metadata = /** @type {Record<string, unknown>} */ (value);
  const { backendType, capabilities } = metadata;
  if (typeof backendType !== 'string' || !RDF_BACKEND_TYPES.includes(backendType)) {
    throw new Error('RDF backend type is not supported');
  }
  if (capabilities === null || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    throw new Error('RDF backend capabilities must be an object');
  }

  const capabilityMap = /** @type {Record<string, unknown>} */ (capabilities);
  const capabilityKeys = Object.keys(capabilityMap);
  const unknown = capabilityKeys.filter((name) => !RDF_BACKEND_CAPABILITY_NAMES.includes(name));
  const missing = RDF_BACKEND_CAPABILITY_NAMES.filter((name) => !capabilityKeys.includes(name));
  if (unknown.length > 0) throw new Error(`unknown RDF backend capabilities: ${unknown.join(', ')}`);
  if (missing.length > 0) throw new Error(`missing RDF backend capabilities: ${missing.join(', ')}`);

  /** @type {Record<string, boolean>} */
  const normalized = {};
  for (const name of RDF_BACKEND_CAPABILITY_NAMES) {
    if (typeof capabilityMap[name] !== 'boolean') {
      throw new Error(`RDF backend capability ${name} must be boolean`);
    }
    normalized[name] = /** @type {boolean} */ (capabilityMap[name]);
  }

  return Object.freeze({ backendType, capabilities: Object.freeze(normalized) });
}

/**
 * Backend-neutral boundary for a derived Wikibase RDF dataset.
 *
 * Implementations must not treat the RDF store as the entity source of truth.
 * They receive structured, trusted inputs from the synchronization service and
 * must not construct shell commands from those inputs.
 *
 * Endpoint return values are descriptors so callers can keep public query and
 * internal mutation access on separate security boundaries.
 */
export class RdfBackend {
  /** @returns {{backendType: string, capabilities: Readonly<Record<string, boolean>>}} */
  metadata() { return notImplemented('metadata'); }

  /** @param {{instanceId: string}} _context @returns {Promise<unknown>} */
  async initialize(_context) { return notImplemented('initialize'); }

  /** @returns {Promise<{status: 'healthy'|'degraded'|'unhealthy', details?: object}>} */
  async health() { return notImplemented('health'); }

  /** @param {{source: string, mediaType: string, checksum?: string}} _snapshot @returns {Promise<unknown>} */
  async loadSnapshot(_snapshot) { return notImplemented('loadSnapshot'); }

  /** @param {{source: string, mediaType: string, checksum?: string}} _snapshot @returns {Promise<unknown>} */
  async replaceDataset(_snapshot) { return notImplemented('replaceDataset'); }

  /** @param {{entityId: string, revision: string, graphIri: string, source: string, mediaType: string}} _change @returns {Promise<unknown>} */
  async applyEntityChange(_change) { return notImplemented('applyEntityChange'); }

  /** @param {{graphIri: string, source: string, mediaType: string}} _graph @returns {Promise<unknown>} */
  async replaceNamedGraph(_graph) { return notImplemented('replaceNamedGraph'); }

  /** @param {{graphIri: string}} _graph @returns {Promise<unknown>} */
  async deleteNamedGraph(_graph) { return notImplemented('deleteNamedGraph'); }

  /** @param {{generationId: string, sourceSnapshotCursor: object}} _request @returns {Promise<object>} */
  async createGeneration(_request) { return notImplemented('createGeneration'); }

  /** @param {{generationId: string, snapshot: {source: string, mediaType: string, checksum?: string}}} _request @returns {Promise<unknown>} */
  async loadSnapshotIntoGeneration(_request) { return notImplemented('loadSnapshotIntoGeneration'); }

  /** @param {{generationId: string, entityId: string, revision: number, graphIri: string, source: string, mediaType: string}} _request @returns {Promise<unknown>} */
  async applyEntityChangeToGeneration(_request) { return notImplemented('applyEntityChangeToGeneration'); }

  /** @param {{generationId: string, entityId: string, graphIri: string}} _request @returns {Promise<unknown>} */
  async deleteEntityFromGeneration(_request) { return notImplemented('deleteEntityFromGeneration'); }

  /** @param {{generationId: string, sparql: string}} _request @returns {Promise<object>} */
  async queryGeneration(_request) { return notImplemented('queryGeneration'); }

  /** @param {{generationId: string, expectedChecksum?: string}} _request @returns {Promise<object>} */
  async validateGeneration(_request) { return notImplemented('validateGeneration'); }

  /** @returns {Promise<object|null>} */
  async getServingGeneration() { return notImplemented('getServingGeneration'); }

  /** @param {{generationId: string, expectedServingGenerationId: string|null}} _request @returns {Promise<object>} */
  async promoteGeneration(_request) { return notImplemented('promoteGeneration'); }

  /** @param {{promotionId: string}} _request @returns {Promise<object>} */
  async rollbackPromotion(_request) { return notImplemented('rollbackPromotion'); }

  /** @param {{generationId: string}} _request @returns {Promise<unknown>} */
  async retireGeneration(_request) { return notImplemented('retireGeneration'); }

  /** @param {{generationId: string}} _request @returns {Promise<unknown>} */
  async deleteGeneration(_request) { return notImplemented('deleteGeneration'); }

  /** @returns {Promise<object[]>} */
  async listGenerations() { return notImplemented('listGenerations'); }

  /** @returns {{url: string, access: 'public-read'|'internal-read'}} */
  sparqlQueryEndpoint() { return notImplemented('sparqlQueryEndpoint'); }

  /** @returns {{url: string, access: 'internal-write'}|null} */
  internalUpdateEndpoint() { return notImplemented('internalUpdateEndpoint'); }

  /** @param {string} _sparql @returns {Promise<object>} */
  async query(_sparql) { return notImplemented('query'); }

  /** @param {{destination: string, mediaType: string}} _request @returns {Promise<unknown>} */
  async exportDataset(_request) { return notImplemented('exportDataset'); }

  /** @param {{snapshot?: {source: string, mediaType: string, checksum?: string}}} _request @returns {Promise<unknown>} */
  async rebuild(_request) { return notImplemented('rebuild'); }

  /** @param {{confirmationToken: string}} _request @returns {Promise<unknown>} */
  async reset(_request) { return notImplemented('reset'); }

  /** @returns {Promise<unknown>} */
  async shutdown() { return notImplemented('shutdown'); }
}

/**
 * @param {string} operation
 * @returns {never}
 */
function notImplemented(operation) {
  throw new Error(`RdfBackend.${operation} is not implemented`);
}
