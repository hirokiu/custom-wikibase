const TARGETS = Object.freeze({
  'apple-silicon': Object.freeze({ context: 'desktop-linux', architecture: 'arm64', hostArchitecture: 'linux/arm64' }),
  'linux-amd64': Object.freeze({ context: 'default', architecture: 'amd64', hostArchitecture: 'linux/amd64' })
});

export function selectedDockerTarget(environment = process.env) {
  const name = environment.JWB_DOCKER_TARGET ?? 'apple-silicon';
  const target = TARGETS[name];
  if (!target) throw new Error(`UNSAFE_DOCKER_TARGET_NAME:${name}`);
  return Object.freeze({ name, ...target });
}

export function assertDockerTarget(target, context, operatingSystem, architecture) {
  if (context !== target.context) throw new Error(`UNSAFE_DOCKER_CONTEXT:${context}`);
  if (target.name === 'apple-silicon' && (!operatingSystem.startsWith('Docker Desktop') || architecture !== 'aarch64')) throw new Error(`UNSAFE_DOCKER_HOST:${operatingSystem}:${architecture}`);
  if (target.name === 'linux-amd64' && (operatingSystem.startsWith('Docker Desktop') || !['amd64', 'x86_64'].includes(architecture))) throw new Error(`UNSAFE_DOCKER_HOST:${operatingSystem}:${architecture}`);
  return target;
}
