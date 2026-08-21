#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { JWB_BASE_URL, JWB_DOCKER_CONTEXT, JWB_PROJECT, JWB_STATE_FILE, assertJwbDockerTarget, stateEnvironment } from './jwb-lib.mjs';
import { RDF_MANIFEST_FILE, RDF_METRICS_FILE, RDF_SNAPSHOT_FILE, snapshotMetrics, verifySnapshotSemantics } from './jwb-rdf-lib.mjs';

assertLocalDocker();
const state = readState();
const manifest = existsSync(RDF_MANIFEST_FILE) ? JSON.parse(readFileSync(RDF_MANIFEST_FILE, 'utf8')) : await createDataset(state);
await verifyEntityData(manifest.subjectItem);
const started = performance.now();
const rdf = capture('docker', ['compose', '--project-name', JWB_PROJECT, '--file', composeFile(), 'exec', '--no-TTY', 'wikibase', 'php', 'extensions/Wikibase/repo/maintenance/dumpRdf.php', '--format', 'n-triples']);
const metrics = snapshotMetrics(rdf, performance.now() - started);
verifySnapshotSemantics(rdf, manifest);
writePrivate(RDF_SNAPSHOT_FILE, rdf);
writePrivate(RDF_METRICS_FILE, `${JSON.stringify(metrics, null, 2)}\n`);
console.log(`M2 RDF snapshot: ${metrics.triples} triples, ${metrics.bytes} bytes, ${metrics.durationMs} ms, sha256=${metrics.sha256}`);

async function createDataset(localState) {
  const session = await login(localState);
  const properties = {};
  for (const [key, datatype, ja, en] of [
    ['string', 'string', 'M2 文字列', 'M2 string'], ['externalId', 'external-id', 'M2 外部ID', 'M2 external ID'],
    ['quantity', 'quantity', 'M2 数量', 'M2 quantity'], ['time', 'time', 'M2 日時', 'M2 time'],
    ['item', 'wikibase-item', 'M2 項目', 'M2 item'], ['qualifier', 'string', 'M2 修飾子', 'M2 qualifier'],
    ['reference', 'url', 'M2 出典URL', 'M2 reference URL']
  ]) properties[key] = await createEntity(session, 'property', { datatype, labels: terms(ja, en) });
  const relatedItem = await createEntity(session, 'item', { labels: terms('M2 関連項目', 'M2 related item') });
  const claims = {};
  claims[properties.string] = [statement(properties.string, 'string', stringValue('M2 direct value'), {
    qualifiers: { [properties.qualifier]: [snak(properties.qualifier, 'string', stringValue('qualified'))] },
    references: [{ snaks: { [properties.reference]: [snak(properties.reference, 'url', stringValue('https://example.invalid/m2-source'))] }, 'snaks-order': [properties.reference] }]
  })];
  claims[properties.externalId] = [statement(properties.externalId, 'external-id', stringValue('JWB-M2-001'))];
  claims[properties.quantity] = [statement(properties.quantity, 'quantity', { value: { amount: '+42', unit: '1' }, type: 'quantity' })];
  claims[properties.time] = [statement(properties.time, 'time', { value: { time: '+2026-08-19T00:00:00Z', timezone: 0, before: 0, after: 0, precision: 11, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' }, type: 'time' })];
  claims[properties.item] = [statement(properties.item, 'wikibase-item', { value: { 'entity-type': 'item', 'numeric-id': Number(relatedItem.slice(1)), id: relatedItem }, type: 'wikibase-entityid' })];
  const subjectItem = await createEntity(session, 'item', {
    labels: terms('M2 RDF 適合性項目', 'M2 RDF conformance item'),
    descriptions: terms('RDF バックエンド共通試験用', 'For RDF backend conformance tests'),
    aliases: { ja: [{ language: 'ja', value: 'M2 試験項目' }], en: [{ language: 'en', value: 'M2 test item' }] }, claims
  });
  const result = { version: 1, generatedAt: new Date().toISOString(), subjectItem, relatedItem, properties };
  writePrivate(RDF_MANIFEST_FILE, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function terms(ja, en) { return { ja: { language: 'ja', value: ja }, en: { language: 'en', value: en } }; }
function stringValue(value) { return { value, type: 'string' }; }
function snak(property, datatype, datavalue) { return { snaktype: 'value', property, datatype, datavalue }; }
function statement(property, datatype, datavalue, extra = {}) { return { type: 'statement', rank: 'normal', mainsnak: snak(property, datatype, datavalue), ...extra }; }

async function login(localState) {
  let response = await api({ action: 'query', meta: 'tokens', type: 'login' });
  response = await api({ action: 'login', lgname: localState.adminUser, lgpassword: localState.adminPassword, lgtoken: response.data.query.tokens.logintoken }, response.cookie, true);
  if (response.data.login?.result !== 'Success') throw new Error('local administrator login failed');
  const csrf = await api({ action: 'query', meta: 'tokens' }, response.cookie);
  return { cookie: csrf.cookie, token: csrf.data.query.tokens.csrftoken };
}

async function createEntity(session, kind, data) {
  const response = await api({ action: 'wbeditentity', new: kind, token: session.token, data: JSON.stringify(data), summary: 'M2 local RDF conformance fixture' }, session.cookie, true);
  const id = response.data.entity?.id;
  if (!/^[QP][1-9][0-9]*$/u.test(id)) throw new Error(`failed to create ${kind}: ${response.data.error?.code ?? 'unexpected response'}`);
  return id;
}

async function verifyEntityData(id) {
  const response = await fetch(`${JWB_BASE_URL}/wiki/Special:EntityData/${id}.ttl`);
  const body = await response.text();
  const identifiesEntity = body.includes(`<${JWB_BASE_URL}/entity/${id}>`) ||
    (body.includes(`@prefix wd: <${JWB_BASE_URL}/entity/>`) && body.includes(`wd:${id}`));
  if (!response.ok || !identifiesEntity) throw new Error(`Special:EntityData verification failed for ${id}`);
}

async function api(parameters, cookie = '', post = false) {
  const values = { format: 'json', formatversion: '2', ...parameters };
  const response = post
    ? await fetch(`${JWB_BASE_URL}/api.php`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: new URLSearchParams(values) })
    : await fetch(`${JWB_BASE_URL}/api.php?${new URLSearchParams(values)}`, { headers: cookie ? { cookie } : {} });
  if (!response.ok) throw new Error(`MediaWiki API returned HTTP ${response.status}`);
  const cookieMap = new Map();
  for (const value of cookie ? cookie.split('; ') : []) cookieMap.set(value.split('=', 1)[0], value);
  for (const value of response.headers.getSetCookie?.() ?? []) { const pair = value.split(';', 1)[0]; cookieMap.set(pair.split('=', 1)[0], pair); }
  const pairs = [...cookieMap.values()].join('; ');
  return { data: await response.json(), cookie: pairs };
}

function assertLocalDocker() {
  const context = capture('docker', ['context', 'show']).trim();
  const [os, architecture] = capture('docker', ['info', '--format', '{{.OperatingSystem}}\n{{.Architecture}}']).trim().split('\n');
  assertJwbDockerTarget({ context, operatingSystem: os.includes('Docker Desktop') ? 'linux' : os.toLowerCase(), architecture });
}
function readState() { if (!existsSync(JWB_STATE_FILE)) throw new Error('M1 state missing; run npm run jwb:create'); const value = JSON.parse(readFileSync(JWB_STATE_FILE, 'utf8')); stateEnvironment(value); return value; }
function composeFile() { return new URL('../infrastructure/japan-wikibase/compose.yaml', import.meta.url).pathname; }
function capture(command, args) { return execFileSync(command, args, { encoding: 'utf8', env: { ...process.env, DOCKER_CONTEXT: JWB_DOCKER_CONTEXT }, stdio: ['ignore', 'pipe', 'pipe'] }); }
function writePrivate(path, body) { writeFileSync(path, body, { mode: 0o600 }); chmodSync(path, 0o600); }
