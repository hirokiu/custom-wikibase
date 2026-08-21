#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, freemem, hostname, totalmem } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const artifactDir = resolve(root, 'artifacts/linux-amd64');
const sourceArtifact = resolve(root, 'artifacts/jwb-release/qualification.json');
const environment = { ...process.env, JWB_DOCKER_TARGET: 'linux-amd64' };

assert(process.platform === 'linux' && process.arch === 'x64', `UNSAFE_L1_HOST:${process.platform}:${process.arch}`);
assert(command('docker', ['context', 'show']) === 'default', 'UNSAFE_L1_DOCKER_CONTEXT');
assert(command('docker', ['info', '--format', '{{.Architecture}}']) === 'x86_64', 'UNSAFE_L1_DOCKER_ARCHITECTURE');

const startedAt = new Date().toISOString();
const run = spawnSync(process.execPath, ['scripts/jwb-release-qualify.mjs'], { cwd: root, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
process.stdout.write(run.stdout ?? '');
process.stderr.write(run.stderr ?? '');

mkdirSync(artifactDir, { recursive: true });
const qualification = JSON.parse(readFileSync(sourceArtifact, 'utf8'));
const environmentEvidence = {
  schemaVersion: 1,
  startedAt,
  completedAt: new Date().toISOString(),
  host: hostname(),
  osRelease: command('sh', ['-c', '. /etc/os-release && printf "%s %s" "$PRETTY_NAME" "$VERSION_ID"']),
  kernel: command('uname', ['-r']),
  architecture: command('uname', ['-m']),
  cpuCount: cpus().length,
  cpuModel: cpus()[0]?.model ?? null,
  memoryBytes: totalmem(),
  availableMemoryBytes: freemem(),
  docker: command('docker', ['version', '--format', '{{.Server.Version}}|{{.Server.Os}}|{{.Server.Arch}}']),
  compose: command('docker', ['compose', 'version', '--short']),
  node: process.version,
  npm: command('npm', ['--version']),
  sourceCommit: command('git', ['rev-parse', 'HEAD']),
  sourceDescribe: command('git', ['describe', '--tags', '--exact-match', 'HEAD'])
};
const images = Object.values(qualification.profiles).flatMap((profile) => profile.architecture ?? []);
const uniqueImages = [...new Map(images.map((image) => [`${image.service}|${image.image}`, image])).values()];
const resources = { cpuCount: environmentEvidence.cpuCount, memoryBytes: environmentEvidence.memoryBytes, availableMemoryBytes: environmentEvidence.availableMemoryBytes };
const cleanup = qualification.cleanup;
const timings = Object.fromEntries(Object.entries(qualification.profiles).map(([profile, result]) => [profile, result.durationSeconds ?? null]));

write('environment.json', environmentEvidence);
write('qualification.json', qualification);
write('images.json', { schemaVersion: 1, architecture: 'linux/amd64', images: uniqueImages });
write('timings.json', { schemaVersion: 1, profilesSeconds: timings, totalSeconds: qualification.durationSeconds });
write('resources.json', { schemaVersion: 1, ...resources });
write('cleanup.json', cleanup);
writeFileSync(resolve(artifactDir, 'summary.md'), `# Custom Wikibase Linux AMD64 qualification\n\n- Source: ${environmentEvidence.sourceDescribe} (${environmentEvidence.sourceCommit})\n- Host: ${environmentEvidence.host}\n- Architecture: linux/amd64\n- Classification: **${qualification.classification}**\n- Core-only: ${qualification.profiles.none?.status ?? 'NOT RUN'}\n- Virtuoso: ${qualification.profiles.virtuoso?.status ?? 'NOT RUN'}\n- Fuseki/TDB2: ${qualification.profiles['fuseki-tdb2']?.status ?? 'NOT RUN'}\n- Oxigraph: ${qualification.profiles.oxigraph?.status ?? 'NOT RUN'}\n- Production readiness: not claimed\n`);
chmodSync(resolve(artifactDir, 'summary.md'), 0o644);
copyFileSync(resolve(root, 'infrastructure/japan-wikibase/image-inventory.json'), resolve(artifactDir, 'declared-images.json'));
if (run.status !== 0 || qualification.classification !== 'J2F_STANDALONE_RC_READY') process.exitCode = run.status || 1;

function command(file, args) { return execFileSync(file, args, { cwd: root, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function write(name, value) { const path = resolve(artifactDir, name); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); chmodSync(path, 0o644); }
function assert(value, message) { if (!value) throw new Error(message); }
