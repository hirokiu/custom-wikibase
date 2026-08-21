import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  JWB_PROJECT,
  assertJwbDockerTarget,
  createJwbState,
  stateEnvironment
} from './jwb-lib.mjs';

test('accepts only the native Apple Silicon Docker Desktop target', () => {
  assert.doesNotThrow(() => assertJwbDockerTarget({
    context: 'desktop-linux', operatingSystem: 'linux', architecture: 'aarch64'
  }));
  for (const target of [
    { context: 'production', operatingSystem: 'linux', architecture: 'aarch64' },
    { context: 'desktop-linux', operatingSystem: 'linux', architecture: 'x86_64' },
    { context: 'desktop-linux', operatingSystem: 'darwin', architecture: 'aarch64' }
  ]) assert.throws(() => assertJwbDockerTarget(target), /refusing|requires native/);
});

test('creates isolated runtime state without exposing it in command arguments', () => {
  const state = createJwbState();
  const environment = stateEnvironment(state);
  assert.equal(state.project, JWB_PROJECT);
  assert.equal(environment.JWB_DB_NAME, 'japan_wikibase');
  assert.ok(environment.JWB_DB_PASSWORD.length >= 40);
  assert.ok(environment.JWB_SECRET_KEY.length >= 60);
  assert.throws(() => stateEnvironment({ ...state, project: 'another-project' }), /invalid M1 state/);
});

test('M1 compose is backend-free and pins reproducible ARM64 inputs', () => {
  const compose = readFileSync('infrastructure/japan-wikibase/compose.yaml', 'utf8');
  const dockerfile = readFileSync('infrastructure/japan-wikibase/Dockerfile', 'utf8');
  const lock = JSON.parse(readFileSync('infrastructure/japan-wikibase/composer.lock', 'utf8'));
  for (const forbidden of ['fuseki', 'virtuoso', 'blazegraph', 'wdqs', 'oxigraph', 'qlever', 'sparql']) {
    assert.doesNotMatch(compose, new RegExp(forbidden, 'iu'));
  }
  assert.match(compose, /mariadb:10\.11\.14@sha256:[a-f0-9]{64}/u);
  assert.match(dockerfile, /mediawiki:1\.43\.9@sha256:[a-f0-9]{64}/u);
  assert.match(dockerfile, /WIKIBASE_REF=c79eb4efab9ad27267a6df9034e1b99ad695d1c7/u);
  assert.match(dockerfile, /COPY composer\.lock/u);
  assert.ok(Array.isArray(lock.packages) && lock.packages.length > 0);
});
