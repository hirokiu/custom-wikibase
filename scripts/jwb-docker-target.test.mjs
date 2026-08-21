import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDockerTarget, selectedDockerTarget } from './jwb-docker-target.mjs';

test('keeps Apple Silicon Docker Desktop as the default target', () => {
  const target = selectedDockerTarget({});
  assert.equal(target.context, 'desktop-linux');
  assert.doesNotThrow(() => assertDockerTarget(target, 'desktop-linux', 'Docker Desktop', 'aarch64'));
});

test('accepts only native Linux AMD64 for the explicit qualification target', () => {
  const target = selectedDockerTarget({ JWB_DOCKER_TARGET: 'linux-amd64' });
  assert.doesNotThrow(() => assertDockerTarget(target, 'default', 'Debian GNU/Linux 13 (trixie)', 'x86_64'));
  assert.throws(() => assertDockerTarget(target, 'desktop-linux', 'Docker Desktop', 'x86_64'), /UNSAFE_DOCKER_CONTEXT/u);
  assert.throws(() => assertDockerTarget(target, 'default', 'Debian GNU/Linux 13', 'aarch64'), /UNSAFE_DOCKER_HOST/u);
  assert.throws(() => selectedDockerTarget({ JWB_DOCKER_TARGET: 'anything-else' }), /UNSAFE_DOCKER_TARGET_NAME/u);
});
