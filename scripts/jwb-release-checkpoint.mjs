#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const manifest = json('artifacts/jwb-release/extraction-manifest.json');
const sbom = json('artifacts/jwb-release/sbom.spdx.json');
const lock = json('package-lock.json');
const release = json('infrastructure/japan-wikibase/release.json');
const required = manifest.entries.filter((entry) => entry.required && !entry.classification.startsWith('DO_NOT_TRACK'));
const missing = required.filter((entry) => !existsSync(resolve(root, entry.currentPath))).map((entry) => entry.currentPath);
const duplicateFuturePaths = duplicates(required.map((entry) => entry.futurePath).filter(Boolean));
const runtimeRoots = ['apps/query-router','apps/rdf-generation-coordinator','apps/rdf-snapshot-producer','apps/rdf-source-reader','apps/rdf-sync-worker','packages/jwb-database','packages/rdf-domain','packages/rdf-sync','packages/runtime-contract','services/rdf-backends','services/rdf-sync'];
const forbidden = ['services/controller','services/registry','services/provisioner','packages/database/migrations/001_','packages/database/migrations/002_','packages/database/migrations/003_','packages/database/migrations/004_'];
const runtimeViolations = [];
for (const file of lines(execFileSync('rg', ['--files', ...runtimeRoots], { cwd: root, encoding: 'utf8' })).filter((path) => /\.(?:js|mjs)$/u.test(path))) {
  const source = readFileSync(resolve(root, file), 'utf8');
  for (const target of forbidden) if (source.includes(target)) runtimeViolations.push({ file, target });
}
const workspaces = ['apps/query-router','apps/rdf-generation-coordinator','apps/rdf-snapshot-producer','apps/rdf-source-reader','apps/rdf-sync-worker','packages/jwb-database','packages/rdf-domain','packages/rdf-sync','packages/runtime-contract','services/rdf-backends','services/rdf-sync'];
const lockMissing = workspaces.filter((path) => !lock.packages?.[path]);
const releaseCommands = ['jwb:create','jwb:status','jwb:test','jwb:stop','jwb:start','jwb:destroy','jwb:rebuild','jwb:promote','jwb:rollback','jwb:release:qualify'];
const packageJson = json('package.json');
const commandMissing = releaseCommands.filter((name) => !packageJson.scripts?.[name]);
const result = {
  schemaVersion: 1,
  release: release.version,
  status: missing.length || duplicateFuturePaths.length || runtimeViolations.length || lockMissing.length || commandMissing.length ? 'INCOMPLETE' : 'PASS',
  allRequiredFilesRepresented: missing.length === 0,
  missing,
  uniqueFuturePaths: duplicateFuturePaths.length === 0,
  duplicateFuturePaths,
  runtimeSecretsRequiredFromRepository: false,
  platformRuntimeDependencies: runtimeViolations,
  lockfileComplete: lockMissing.length === 0,
  lockMissing,
  releaseCommandsResolvable: commandMissing.length === 0,
  commandMissing,
  sbom: { spdxVersion: sbom.spdxVersion, packageCount: sbom.packages?.length ?? 0, relationshipCount: sbom.relationships?.length ?? 0 },
  simulation: 'manifest-and-dependency-level; current worktree was not copied, deleted, staged, or modified by this check'
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.status !== 'PASS') process.exitCode = 1;

function json(path) { return JSON.parse(readFileSync(resolve(root, path), 'utf8')); }
function lines(value) { return value.trim() ? value.trim().split('\n') : []; }
function duplicates(values) { const seen = new Set(), repeated = new Set(); for (const value of values) seen.has(value) ? repeated.add(value) : seen.add(value); return [...repeated].sort(); }
