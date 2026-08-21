import { execFile as nodeExecFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { validateGenerationId } from '../../../packages/rdf-sync/src/generation.js';
import { SparqlHttpBackend } from '../../rdf-backends/src/sparql-http-backend.js';
import { RDF_BACKEND_PROFILES } from '../../rdf-backends/src/profiles.js';

const PROFILES = Object.freeze({
  virtuoso: Object.freeze({ key: 'virtuoso', ports: Object.freeze({ 'gen-a': 19190, 'gen-b': 19191, 'gen-c': 19192 }) }),
  oxigraph: Object.freeze({ key: 'oxigraph', ports: Object.freeze({ 'gen-a': 18178, 'gen-b': 18179, 'gen-c': 18180 }) }),
  'fuseki-tdb2': Object.freeze({ key: 'fuseki', ports: Object.freeze({ 'gen-a': 13330, 'gen-b': 13331, 'gen-c': 13332 }) }),
});

export class LocalComposeGenerationDriver {
  /** @param {{backendType: string, dockerContext?: string, execFile?: Function, adminPassword?: string}} options */
  constructor({ backendType, dockerContext = 'desktop-linux', execFile = promisify(nodeExecFile), adminPassword }) {
    if (!PROFILES[backendType]) throw new Error('unsupported local generation backend');
    if (dockerContext !== 'desktop-linux') throw new Error('local generation driver requires Docker Desktop');
    this.backendType = backendType; this.profile = PROFILES[backendType]; this.dockerContext = dockerContext; this.execFile = execFile;
    if (adminPassword !== undefined && adminPassword.length < 16) throw new Error('invalid local backend credential');
    this.passwords = new Map(); this.adminPassword = adminPassword;
  }

  descriptor(generationId) {
    validateGenerationId(generationId);
    const port = this.profile.ports[generationId];
    if (!port) throw new Error('generation ID is not allocated by local profile');
    const project = `wfp-jwb-m9-${this.profile.key}-${generationId}`;
    const root = new URL('../../../infrastructure/japan-wikibase/rdf/', import.meta.url).pathname;
    const password = this.passwords.get(generationId) ?? this.adminPassword ?? randomBytes(32).toString('base64url');
    this.passwords.set(generationId, password);
    const base = `http://127.0.0.1:${port}`;
    const endpoints = this.backendType === 'fuseki-tdb2' ? { queryUrl: `${base}/jwb/query`, updateUrl: `${base}/jwb/update`, graphStoreUrl: `${base}/jwb/data` } : this.backendType === 'oxigraph' ? { queryUrl: `${base}/query`, updateUrl: `${base}/update`, graphStoreUrl: `${base}/store` } : { queryUrl: `${base}/sparql`, updateUrl: `${base}/sparql-auth`, graphStoreUrl: `${base}/sparql-graph-crud-auth`, digestAuth: { username: 'dba', password } };
    return Object.freeze({ generationId, backendType: this.backendType, project, root, file: `${root}compose.rdf-${this.profile.key}.yaml`, port, env: Object.freeze({ DOCKER_CONTEXT: this.dockerContext, JWB_RDF_HOST_PORT: String(port), JWB_RDF_ADMIN_PASSWORD: password }), endpoints: Object.freeze(endpoints) });
  }

  async createGeneration({ generationId }) { const value = this.descriptor(generationId); await this.#compose(value, ['up', '--detach', '--build']); return publicDescriptor(value); }
  async startGeneration({ generationId }) { const value = this.descriptor(generationId); await this.#compose(value, ['start', 'rdf-backend']); return publicDescriptor(value); }
  async restartGeneration({ generationId }) { const value = this.descriptor(generationId); await this.#compose(value, ['restart', 'rdf-backend']); return publicDescriptor(value); }
  async stopGeneration({ generationId }) { const value = this.descriptor(generationId); await this.#compose(value, ['stop', 'rdf-backend']); }
  async retireGeneration({ generationId }) { return this.stopGeneration({ generationId }); }
  async deleteGeneration({ generationId }) { const value = this.descriptor(generationId); await this.#compose(value, ['down', '--volumes', '--remove-orphans']); this.passwords.delete(generationId); }
  backend(generationId) { const value = this.descriptor(generationId); return new SparqlHttpBackend({ ...value.endpoints, metadata: RDF_BACKEND_PROFILES[this.backendType] }); }
  async #compose(value, args) { await this.execFile('docker', ['compose', '--project-name', value.project, '--file', value.file, ...args], { cwd: value.root, env: { ...process.env, ...value.env } }); }
}

function publicDescriptor(value) { return Object.freeze({ generationId: value.generationId, backendType: value.backendType, queryUrl: value.endpoints.queryUrl, healthUrl: value.endpoints.queryUrl, storageIdentity: `${value.project}_data` }); }
