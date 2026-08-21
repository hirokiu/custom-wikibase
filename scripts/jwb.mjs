#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import {
  JWB_BASE_URL,
  JWB_DOCKER_CONTEXT,
  JWB_PROJECT,
  JWB_STATE_FILE,
  assertJwbDockerTarget,
  createJwbState,
  stateEnvironment
} from './jwb-lib.mjs';

const action = process.argv[2];
const composeDirectory = new URL('../infrastructure/japan-wikibase/', import.meta.url).pathname;
const composeFile = `${composeDirectory}compose.yaml`;

if (!['create', 'test', 'stop', 'start', 'destroy'].includes(action)) {
  fail('usage: node scripts/jwb.mjs create|test|stop|start|destroy');
}

assertLocalDocker();
if (action === 'create') create();
if (action === 'test') await testEnvironment();
if (action === 'stop') stop();
if (action === 'start') start();
if (action === 'destroy') destroy();

function create() {
  const state = existsSync(JWB_STATE_FILE) ? readState() : createState();
  compose(['up', '--detach', '--build', '--wait', '--wait-timeout', '900'], state);
  console.log(`Japan Wikibase M1 is ready at ${JWB_BASE_URL}`);
}

async function testEnvironment() {
  const state = readState();
  const serviceOutput = capture('docker', ['compose', '--project-name', JWB_PROJECT, '--file', composeFile, 'ps', '--format', 'json'], state).trim();
  const rows = serviceOutput.startsWith('[')
    ? JSON.parse(serviceOutput)
    : serviceOutput.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  for (const service of ['mariadb', 'wikibase', 'job-runner']) {
    const row = rows.find((entry) => entry.Service === service);
    if (!row || row.State !== 'running') fail(`${service} is not running`);
  }

  for (const service of ['mariadb', 'wikibase', 'job-runner']) {
    const containerId = capture('docker', ['compose', '--project-name', JWB_PROJECT, '--file', composeFile, 'ps', '--quiet', service], state).trim();
    const architecture = capture('docker', ['inspect', '--format', '{{.Platform}}', containerId], state).trim();
    if (architecture !== 'linux') fail(`${service} container platform is unexpected: ${architecture}`);
    const imageId = capture('docker', ['inspect', '--format', '{{.Image}}', containerId], state).trim();
    const imageArchitecture = capture('docker', ['image', 'inspect', '--format', '{{.Architecture}}', imageId], state).trim();
    if (imageArchitecture !== 'arm64') fail(`${service} image is not native ARM64: ${imageArchitecture}`);
  }

  const siteInfo = await apiGet({ action: 'query', meta: 'siteinfo', siprop: 'general|extensions' });
  if (siteInfo.query?.general?.lang !== 'ja') fail('MediaWiki default language is not Japanese');
  if (!String(siteInfo.query?.general?.generator).startsWith('MediaWiki 1.43.9')) fail('unexpected MediaWiki version');
  if (!siteInfo.query?.extensions?.some((extension) => extension.name === 'WikibaseRepository')) fail('Wikibase Repository is not loaded');

  if (state.persistentEntityId) {
    const entity = await apiGet({ action: 'wbgetentities', ids: state.persistentEntityId, languages: 'ja' });
    if (entity.entities?.[state.persistentEntityId]?.missing !== undefined) fail('persistent test entity was lost');
  } else {
    state.persistentEntityId = await createPersistentEntity(state);
    writeState(state);
  }

  const apiModules = await apiGet({ action: 'paraminfo', modules: 'wbgetentities' });
  if (apiModules.paraminfo?.modules?.[0]?.name !== 'wbgetentities') fail('Wikibase API module is unavailable');
  console.log(`jwb test: native ARM64, MediaWiki 1.43.9, Japanese, Wikibase API and persistent ${state.persistentEntityId}=success`);
}

function stop() {
  const state = readState();
  compose(['stop'], state);
  console.log('Japan Wikibase M1 stopped; named volumes were retained');
}

function start() {
  const state = readState();
  compose(['start'], state);
  waitForHealthy(state);
  console.log(`Japan Wikibase M1 restarted at ${JWB_BASE_URL}`);
}

function destroy() {
  if (!existsSync(JWB_STATE_FILE)) {
    console.log('Japan Wikibase M1 state does not exist; nothing to destroy');
    return;
  }
  const state = readState();
  const foreign = capture('docker', ['ps', '--all', '--filter', `label=com.docker.compose.project=${JWB_PROJECT}`, '--format', '{{.Label "com.docker.compose.project"}}'], state)
    .trim().split('\n').filter(Boolean).some((project) => project !== JWB_PROJECT);
  if (foreign) fail('refusing unexpected Compose ownership');
  compose(['down', '--volumes', '--remove-orphans'], state);
  unlinkSync(JWB_STATE_FILE);
  console.log('Removed only the disposable wfp-jwb-m1 containers, networks, volumes and runtime state');
}

function assertLocalDocker() {
  const context = capture('docker', ['context', 'show']).trim();
  const [operatingSystem, architecture] = capture('docker', ['info', '--format', '{{.OperatingSystem}}\n{{.Architecture}}']).trim().split('\n');
  assertJwbDockerTarget({ context, operatingSystem: operatingSystem.includes('Docker Desktop') ? 'linux' : operatingSystem.toLowerCase(), architecture });
}

function createState() {
  const state = createJwbState();
  writeState(state);
  return state;
}

function readState() {
  if (!existsSync(JWB_STATE_FILE)) fail('M1 state is missing; run npm run jwb:create first');
  const state = JSON.parse(readFileSync(JWB_STATE_FILE, 'utf8'));
  stateEnvironment(state);
  return state;
}

function writeState(state) {
  writeFileSync(JWB_STATE_FILE, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  chmodSync(JWB_STATE_FILE, 0o600);
}

function compose(args, state) {
  run('docker', ['compose', '--project-name', JWB_PROJECT, '--file', composeFile, ...args], state);
}

function waitForHealthy(state) {
  compose(['up', '--detach', '--wait', '--wait-timeout', '300', '--no-build'], state);
}

async function createPersistentEntity(state) {
  const loginTokenResponse = await apiGetSession({ action: 'query', meta: 'tokens', type: 'login' });
  const login = await apiPost({
    action: 'login', lgname: state.adminUser, lgpassword: state.adminPassword,
    lgtoken: loginTokenResponse.data.query.tokens.logintoken
  }, loginTokenResponse.cookie);
  if (login.data.login?.result !== 'Success') fail('local administrator login failed');
  const csrf = await apiGetSession({ action: 'query', meta: 'tokens' }, login.cookie);
  const created = await apiPost({
    action: 'wbeditentity', new: 'item', token: csrf.data.query.tokens.csrftoken,
    data: JSON.stringify({ labels: { ja: { language: 'ja', value: 'M1 永続性確認項目' } } }),
    summary: 'Japan Wikibase M1 local persistence test'
  }, csrf.cookie);
  const id = created.data.entity?.id;
  if (!/^Q[1-9][0-9]*$/u.test(id)) fail(`local test entity was not created: ${created.data.error?.code ?? 'unexpected-response'}`);
  return id;
}

async function apiGet(parameters, cookie) {
  return (await apiGetSession(parameters, cookie)).data;
}

async function apiGetSession(parameters, cookie) {
  const url = new URL('/api.php', JWB_BASE_URL);
  for (const [key, value] of Object.entries({ format: 'json', formatversion: '2', ...parameters })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: cookie ? { cookie } : {} });
  if (!response.ok) fail(`local API returned HTTP ${response.status}`);
  const setCookies = response.headers.getSetCookie?.() ?? [];
  const nextCookie = mergeCookies(cookie, setCookies);
  return { data: await response.json(), cookie: nextCookie };
}

async function apiPost(parameters, cookie) {
  const body = new URLSearchParams({ format: 'json', formatversion: '2', ...parameters });
  const response = await fetch(`${JWB_BASE_URL}/api.php`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }, body
  });
  if (!response.ok) fail(`local API returned HTTP ${response.status}`);
  const setCookies = response.headers.getSetCookie?.() ?? [];
  const nextCookie = mergeCookies(cookie, setCookies);
  return { data: await response.json(), cookie: nextCookie };
}

function mergeCookies(current, setCookies) {
  const cookies = new Map();
  for (const pair of current ? current.split('; ') : []) cookies.set(pair.split('=', 1)[0], pair);
  for (const value of setCookies) {
    const pair = value.split(';', 1)[0];
    cookies.set(pair.split('=', 1)[0], pair);
  }
  return [...cookies.values()].join('; ');
}

function commandEnvironment(state) {
  return { ...process.env, DOCKER_CONTEXT: JWB_DOCKER_CONTEXT, ...stateEnvironment(state) };
}

function capture(command, args, state) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', cwd: composeDirectory, env: state ? commandEnvironment(state) : process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    fail(String(error.stderr || error.message));
  }
}

function run(command, args, state) {
  console.log(`jwb: ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd: composeDirectory, env: commandEnvironment(state), stdio: 'inherit' });
}

function fail(message) {
  console.error(`jwb safety guard: ${message}`);
  process.exit(1);
}
