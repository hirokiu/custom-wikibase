#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { JWB_BASE_URL, JWB_DOCKER_CONTEXT, JWB_PROJECT, JWB_STATE_FILE, assertJwbDockerTarget, stateEnvironment } from './jwb-lib.mjs';
import { canonicalizeNTriples, diffNTriples, entityClosure, nodeSubjects, sha256, summarizeDiff } from './jwb-m3-lib.mjs';

const artifactDirectory = new URL('../artifacts/jwb-m3/', import.meta.url).pathname;
const composeFile = new URL('../infrastructure/japan-wikibase/compose.yaml', import.meta.url).pathname;
const datasetRunId = new Date().toISOString().replace(/\D/gu, '').slice(0, 14);
assertLocalDocker();
const state = readState();
mkdirSync(artifactDirectory, { recursive: true });
const session = await login(state);
const manifest = await createDataset(session);
writeArtifact('entity-manifest.json', manifest);

const observations = { version: 1, capturedAt: new Date().toISOString(), mutations: [], recentChanges: [] };
let previous = captureDump('baseline');
const baselineClosure = entityClosure(previous.rdf, manifest.entities);
writeText('baseline.dynamic.nt', baselineClosure);
for (const id of manifest.entities) writeText(`entity-${id}.nt`, canonicalizeNTriples(await entityRdf(id)));

const shared = analyzeSharedNodes(previous.rdf, manifest);
writeArtifact('shared-node-analysis.json', shared);

for (const mutation of mutationCases(manifest)) {
  const response = await mutation.apply(session);
  const revision = findRevision(response);
  const current = captureDump(mutation.id);
  const beforeClosure = entityClosure(previous.rdf, manifest.entities);
  const afterClosure = entityClosure(current.rdf, manifest.entities);
  const diff = diffNTriples(beforeClosure, afterClosure);
  writeText(`diff-${mutation.id}.removed.nt`, diff.removed.join('\n') + (diff.removed.length ? '\n' : ''));
  writeText(`diff-${mutation.id}.added.nt`, diff.added.join('\n') + (diff.added.length ? '\n' : ''));
  const entity = canonicalizeNTriples(await entityRdf(mutation.entity));
  writeText(`entity-${mutation.id}-${mutation.entity}.nt`, entity);
  const recentChange = await latestRecentChange(mutation.entity);
  observations.mutations.push({ id: mutation.id, description: mutation.description, entity: mutation.entity, revision, ...summarizeDiff(diff), snapshot: current.metrics });
  observations.recentChanges.push({ mutation: mutation.id, ...recentChange });
  previous = current;
}

const entityComparison = {};
for (const id of manifest.entities) {
  const specific = canonicalizeNTriples(await entityRdf(id));
  const fullClosure = entityClosure(previous.rdf, [id]);
  const comparison = diffNTriples(fullClosure, specific);
  entityComparison[id] = { entityTriples: countTriples(specific), fullClosureTriples: countTriples(fullClosure), fullOnly: comparison.removed.length, entityOnly: comparison.added.length };
}
writeArtifact('entity-vs-dump.json', entityComparison);
writeArtifact('mutation-observations.json', observations);
console.log(JSON.stringify({ manifest, baseline: observations.mutations.length ? JSON.parse(readFileSync(`${artifactDirectory}metrics-baseline.json`, 'utf8')) : null, shared, mutationCount: observations.mutations.length }, null, 2));

async function createDataset(auth) {
  const properties = {};
  for (const [key, datatype] of Object.entries({ string: 'string', externalId: 'external-id', item: 'wikibase-item', quantity: 'quantity', time: 'time', qualifier: 'string', reference: 'url' })) {
    properties[key] = await createEntity(auth, 'property', { datatype, labels: terms(`M9B ${datasetRunId} ${key}`, `M9B ${datasetRunId} ${key}`) });
  }
  const q3 = await createEntity(auth, 'item', { labels: terms(`M9B ${datasetRunId} 対象項目`, `M9B ${datasetRunId} target item`) });
  const makeClaims = () => {
    const claims = {};
    claims[properties.string] = [statement(properties.string, 'string', stringValue('shared string'), {
      qualifiers: { [properties.qualifier]: [snak(properties.qualifier, 'string', stringValue('shared qualifier'))] },
      references: [{ snaks: { [properties.reference]: [snak(properties.reference, 'url', stringValue('https://example.invalid/m3-source'))] }, 'snaks-order': [properties.reference] }]
    }), statement(properties.string, 'string', stringValue('deletion candidate'))];
    claims[properties.externalId] = [statement(properties.externalId, 'external-id', stringValue('M3-SHARED-ID'))];
    claims[properties.item] = [statement(properties.item, 'wikibase-item', itemValue(q3))];
    claims[properties.quantity] = [statement(properties.quantity, 'quantity', { value: { amount: '+42', unit: '1' }, type: 'quantity' })];
    claims[properties.time] = [statement(properties.time, 'time', timeValue('+2026-08-19T00:00:00Z'))];
    return claims;
  };
  const q1 = await createEntity(auth, 'item', { labels: terms(`M9B ${datasetRunId} 項目1`, `M9B ${datasetRunId} item 1`), descriptions: terms('M9B 基準項目', 'M9B baseline item'), aliases: aliases('M9B別名1', 'M9B alias 1'), claims: makeClaims() });
  const q2 = await createEntity(auth, 'item', { labels: terms(`M9B ${datasetRunId} 項目2`, `M9B ${datasetRunId} item 2`), descriptions: terms('M9B 共有値項目', 'M9B shared-value item'), aliases: aliases('M9B別名2', 'M9B alias 2'), claims: makeClaims() });
  const entities = [q1, q2, q3];
  const entityData = await getEntities(entities);
  const claimIds = {};
  for (const [key, property] of Object.entries(properties)) if (!['qualifier', 'reference'].includes(key)) claimIds[key] = entityData[q1].claims[property][0].id;
  claimIds.deletion = entityData[q1].claims[properties.string][1].id;
  const mainClaim = entityData[q1].claims[properties.string][0];
  return { version: 1, qualification: 'M9B', datasetRunId, generatedAt: new Date().toISOString(), entities, q1, q2, q3, properties, claimIds, qualifierHash: mainClaim.qualifiers[properties.qualifier][0].hash, referenceHash: mainClaim.references[0].hash };
}

function mutationCases(m) {
  return [
    change('A-label-ja', 'Japanese label change', m.q1, (s) => apiPost(s, { action: 'wbsetlabel', id: m.q1, language: 'ja', value: 'M3 項目1 改訂' })),
    change('B-description-en', 'English description change', m.q1, (s) => apiPost(s, { action: 'wbsetdescription', id: m.q1, language: 'en', value: 'M3 changed description' })),
    change('C-alias-add', 'alias add', m.q1, (s) => apiPost(s, { action: 'wbsetaliases', id: m.q1, language: 'ja', add: 'M3追加別名' })),
    change('C-alias-remove', 'alias remove', m.q1, (s) => apiPost(s, { action: 'wbsetaliases', id: m.q1, language: 'ja', remove: 'M3追加別名' })),
    change('D-string', 'string statement value change', m.q1, (s) => setClaimValue(s, m.claimIds.string, 'changed string')),
    change('E-item', 'Item target change', m.q1, (s) => setClaimValue(s, m.claimIds.item, { 'entity-type': 'item', 'numeric-id': Number(m.q2.slice(1)) })),
    change('F-delete', 'statement deletion', m.q1, (s) => apiPost(s, { action: 'wbremoveclaims', claim: m.claimIds.deletion })),
    change('G-qualifier-change', 'qualifier change', m.q1, (s) => apiPost(s, { action: 'wbsetqualifier', claim: m.claimIds.string, property: m.properties.qualifier, snaktype: 'value', value: JSON.stringify('changed qualifier'), snakhash: m.qualifierHash })),
    change('G-qualifier-delete', 'qualifier delete', m.q1, async (s) => { const entity = (await getEntities([m.q1]))[m.q1]; const hash = entity.claims[m.properties.string][0].qualifiers[m.properties.qualifier][0].hash; return apiPost(s, { action: 'wbremovequalifiers', claim: m.claimIds.string, qualifiers: hash }); }),
    change('H-reference-change', 'reference change', m.q1, (s) => apiPost(s, { action: 'wbsetreference', statement: m.claimIds.string, reference: m.referenceHash, snaks: JSON.stringify({ [m.properties.reference]: [snak(m.properties.reference, 'url', stringValue('https://example.invalid/m3-changed'))] }) })),
    change('H-reference-delete', 'reference delete', m.q1, async (s) => { const entity = (await getEntities([m.q1]))[m.q1]; return apiPost(s, { action: 'wbremovereferences', statement: m.claimIds.string, references: entity.claims[m.properties.string][0].references[0].hash }); }),
    change('I-quantity', 'quantity value change', m.q1, (s) => setClaimValue(s, m.claimIds.quantity, { amount: '+43', unit: '1' })),
    change('J-time', 'time value change', m.q1, (s) => setClaimValue(s, m.claimIds.time, timeValue('+2027-08-19T00:00:00Z').value)),
    change('K-external-id', 'external identifier change', m.q1, (s) => setClaimValue(s, m.claimIds.externalId, 'M3-CHANGED-ID'))
  ];
}
function change(id, description, entity, apply) { return { id, description, entity, apply }; }
async function setClaimValue(session, claim, value) { return apiPost(session, { action: 'wbsetclaimvalue', claim, snaktype: 'value', value: JSON.stringify(value) }); }

function captureDump(name) {
  const started = performance.now();
  const rdf = execFileSync('docker', ['compose', '--project-name', JWB_PROJECT, '--file', composeFile, 'exec', '--no-TTY', 'wikibase', 'php', 'extensions/Wikibase/repo/maintenance/dumpRdf.php', '--format', 'nt', '--flavor', 'full-dump'], { encoding: 'utf8', env: { ...process.env, DOCKER_CONTEXT: JWB_DOCKER_CONTEXT }, stdio: ['ignore', 'pipe', 'pipe'] });
  const canonical = canonicalizeNTriples(rdf);
  const metrics = { generatedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), triples: countTriples(canonical), bytes: Buffer.byteLength(canonical), sha256: sha256(canonical) };
  writeText(`${name}.nt`, canonical); writeArtifact(`metrics-${name}.json`, metrics);
  return { rdf: canonical, metrics };
}

function analyzeSharedNodes(rdf, manifest) {
  const closures = Object.fromEntries([manifest.q1, manifest.q2].map((id) => [id, nodeSubjects(entityClosure(rdf, [id]))]));
  const shared = [...closures[manifest.q1]].filter((node) => closures[manifest.q2].has(node));
  return { sharedNodes: shared, byKind: { values: shared.filter((v) => v.includes('/value/')), references: shared.filter((v) => v.includes('/reference/')), statements: shared.filter((v) => v.includes('/entity/statement/')), entities: shared.filter((v) => /\/entity\/Q/u.test(v)) } };
}

async function login(localState) { let token = await apiGet({ action: 'query', meta: 'tokens', type: 'login' }); let response = await rawPost({ action: 'login', lgname: localState.adminUser, lgpassword: localState.adminPassword, lgtoken: token.data.query.tokens.logintoken }, token.cookie); if (response.data.login?.result !== 'Success') throw new Error('local login failed'); token = await rawGet({ action: 'query', meta: 'tokens' }, response.cookie); return { cookie: token.cookie, token: token.data.query.tokens.csrftoken }; }
async function createEntity(session, kind, data) { const result = await apiPost(session, { action: 'wbeditentity', new: kind, data: JSON.stringify(data) }); const id = result.entity?.id; if (!/^[QP][1-9][0-9]*$/u.test(id)) throw new Error(`failed to create ${kind}: ${result.error?.code}`); return id; }
async function getEntities(ids) { return (await apiGet({ action: 'wbgetentities', ids: ids.join('|') })).data.entities; }
async function entityRdf(id) { const response = await fetch(`${JWB_BASE_URL}/wiki/Special:EntityData/${id}.nt`); if (!response.ok) throw new Error(`EntityData ${id} HTTP ${response.status}`); return response.text(); }
async function latestRecentChange(id) { const title = `${id.startsWith('Q') ? 'Item' : 'Property'}:${id}`; const result = await apiGet({ action: 'query', list: 'recentchanges', rctitle: title, rclimit: '1', rcprop: 'title|ids|timestamp|flags|loginfo' }); const rc = result.data.query.recentchanges[0] ?? {}; return { title: rc.title, rcid: rc.rcid, revid: rc.revid, oldRevid: rc.old_revid, type: rc.type, timestamp: rc.timestamp, logtype: rc.logtype, logaction: rc.logaction, redirect: Boolean(rc.redirect) }; }
async function apiPost(session, parameters) { const response = await rawPost({ ...parameters, token: session.token, summary: 'M3 local RDF semantics experiment' }, session.cookie); if (response.data.error) throw new Error(`${parameters.action}: ${JSON.stringify(response.data.error)}`); return response.data; }
async function apiGet(parameters) { return rawGet(parameters, ''); }
async function rawGet(parameters, cookie) { const response = await fetch(`${JWB_BASE_URL}/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...parameters })}`, { headers: cookie ? { cookie } : {} }); return parseResponse(response, cookie); }
async function rawPost(parameters, cookie) { const response = await fetch(`${JWB_BASE_URL}/api.php`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: new URLSearchParams({ format: 'json', formatversion: '2', ...parameters }) }); return parseResponse(response, cookie); }
async function parseResponse(response, cookie) { if (!response.ok) throw new Error(`MediaWiki API HTTP ${response.status}`); const values = new Map(); for (const v of cookie ? cookie.split('; ') : []) values.set(v.split('=', 1)[0], v); for (const v of response.headers.getSetCookie?.() ?? []) { const pair = v.split(';', 1)[0]; values.set(pair.split('=', 1)[0], pair); } return { data: await response.json(), cookie: [...values.values()].join('; ') }; }

function terms(ja, en) { return { ja: { language: 'ja', value: ja }, en: { language: 'en', value: en } }; }
function aliases(ja, en) { return { ja: [{ language: 'ja', value: ja }], en: [{ language: 'en', value: en }] }; }
function stringValue(value) { return { value, type: 'string' }; }
function itemValue(id) { return { value: { 'entity-type': 'item', 'numeric-id': Number(id.slice(1)), id }, type: 'wikibase-entityid' }; }
function timeValue(time) { return { value: { time, timezone: 0, before: 0, after: 0, precision: 11, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' }, type: 'time' }; }
function snak(property, datatype, datavalue) { return { snaktype: 'value', property, datatype, datavalue }; }
function statement(property, datatype, datavalue, extra = {}) { return { type: 'statement', rank: 'normal', mainsnak: snak(property, datatype, datavalue), ...extra }; }
function findRevision(value) { return value.pageinfo?.lastrevid ?? value.entity?.lastrevid ?? value.lastrevid ?? null; }
function countTriples(value) { return value.split('\n').filter((line) => line.endsWith(' .')).length; }
function writeText(name, body) { writeFileSync(`${artifactDirectory}${name}`, body, { mode: 0o600 }); chmodSync(`${artifactDirectory}${name}`, 0o600); }
function writeArtifact(name, value) { writeText(name, `${JSON.stringify(value, null, 2)}\n`); }
function readState() { if (!existsSync(JWB_STATE_FILE)) throw new Error('run npm run jwb:create first'); const value = JSON.parse(readFileSync(JWB_STATE_FILE, 'utf8')); stateEnvironment(value); return value; }
function assertLocalDocker() { const context = execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim(); const [os, architecture] = execFileSync('docker', ['info', '--format', '{{.OperatingSystem}}\n{{.Architecture}}'], { encoding: 'utf8' }).trim().split('\n'); assertJwbDockerTarget({ context, operatingSystem: os.includes('Docker Desktop') ? 'linux' : os.toLowerCase(), architecture }); }
