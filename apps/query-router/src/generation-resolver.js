const BACKENDS = new Set(['virtuoso', 'oxigraph', 'fuseki-tdb2']);
const RUNTIMES = new Set(['kubernetes', 'compose', 'standalone-compose']);
const GENERATION = /^gen-[a-z0-9][a-z0-9-]{0,58}$/u;
const SOURCE = /^[a-z0-9][a-z0-9.-]{0,127}$/u;

/** Resolve a serving pointer through the trusted generation registry. */
export class TrustedGenerationResolver {
  constructor({ generationRepository, runtimeType }) {
    if (!generationRepository || !RUNTIMES.has(runtimeType)) throw new Error('invalid generation resolver configuration');
    this.generationRepository = generationRepository;
    this.runtimeType = runtimeType;
    this.cache = null;
  }

  async resolve(pointer) {
    validatePointer(pointer);
    if (this.cache?.pointerVersion === pointer.version && this.cache.generationId === pointer.generationId) return this.cache.target;
    const descriptor = await this.generationRepository.getDescriptor({ sourceIdentity: pointer.sourceIdentity, generationId: pointer.generationId });
    const target = deriveTarget(descriptor, { expectedSourceIdentity: pointer.sourceIdentity, runtimeType: this.runtimeType });
    this.cache = Object.freeze({ pointerVersion: pointer.version, generationId: pointer.generationId, target });
    return target;
  }
}

export class PostgresGenerationDescriptorRepository {
  constructor({ pool }) { if (!pool) throw new Error('generation descriptor pool is required'); this.pool = pool; }
  async getDescriptor({ sourceIdentity, generationId }) {
    if (!SOURCE.test(sourceIdentity ?? '') || !GENERATION.test(generationId ?? '')) throw new Error('ROUTER_TARGET_UNRESOLVABLE');
    const result = await this.pool.query(
      `SELECT source_identity,generation_id,backend_type,state,normalization_model,partition_model,runtime_type,runtime_namespace
       FROM rdf_generation WHERE source_identity=$1 AND generation_id=$2`, [sourceIdentity, generationId]);
    if (result.rowCount !== 1) throw new Error('ROUTER_TARGET_UNRESOLVABLE');
    return result.rows[0];
  }
}

export function deriveTarget(value, { expectedSourceIdentity, runtimeType }) {
  const descriptor = normalize(value);
  const expectedStoredRuntime = runtimeType === 'standalone-compose' ? 'compose' : runtimeType;
  if (!descriptor || descriptor.sourceIdentity !== expectedSourceIdentity || !SOURCE.test(descriptor.sourceIdentity) || !GENERATION.test(descriptor.generationId) || !BACKENDS.has(descriptor.backendType) || descriptor.runtimeType !== expectedStoredRuntime || descriptor.normalizationModel !== 'jwb-rdf-normalization-v1' || descriptor.partitionModel !== 'jwb-partition-v1' || !['READY', 'SERVING'].includes(descriptor.state)) throw new Error('ROUTER_TARGET_UNRESOLVABLE');
  if (runtimeType === 'standalone-compose') {
    if (descriptor.runtimeType !== 'compose' || !['gen-a', 'gen-b'].includes(descriptor.generationId)) throw new Error('ROUTER_TARGET_UNRESOLVABLE');
    const profile = {
      virtuoso: { port: 8890, path: '/sparql' },
      oxigraph: { port: 7878, path: '/query' },
      'fuseki-tdb2': { port: 3030, path: '/jwb/query' },
    }[descriptor.backendType];
    const service = descriptor.generationId === 'gen-a' ? 'backend-a' : 'backend-b';
    return Object.freeze({ queryUrl: `http://${service}:${profile.port}${profile.path}`, healthUrl: `http://${service}:${profile.port}${profile.path}`, allowedHostname: service });
  }
  if (runtimeType !== 'kubernetes') throw new Error('ROUTER_TARGET_UNRESOLVABLE');
  if (descriptor.namespace !== 'jwb-query-local') throw new Error('ROUTER_TARGET_UNRESOLVABLE');
  const profile = {
    virtuoso: { short: 'virtuoso', port: 8890, path: '/sparql' },
    oxigraph: { short: 'oxigraph', port: 7878, path: '/query' },
    'fuseki-tdb2': { short: 'fuseki', port: 3030, path: '/jwb/query' },
  }[descriptor.backendType];
  const service = `rdf-${profile.short}-${descriptor.generationId}`;
  const queryUrl = `http://${service}.${descriptor.namespace}.svc.cluster.local:${profile.port}${profile.path}`;
  return Object.freeze({ queryUrl, healthUrl: queryUrl, allowedHostname: `${service}.${descriptor.namespace}.svc.cluster.local` });
}

function normalize(v) { return v && { sourceIdentity: v.sourceIdentity ?? v.source_identity, generationId: v.generationId ?? v.generation_id, backendType: v.backendType ?? v.backend_type, state: v.state, normalizationModel: v.normalizationModel ?? v.normalization_model, partitionModel: v.partitionModel ?? v.partition_model, runtimeType: v.runtimeType ?? v.runtime_type, namespace: v.namespace ?? v.runtime_namespace }; }
function validatePointer(v) { if (!v || !SOURCE.test(v.sourceIdentity ?? '') || !GENERATION.test(v.generationId ?? '') || !Number.isInteger(v.version) || v.version < 1) throw new Error('ROUTER_TARGET_UNRESOLVABLE'); }
