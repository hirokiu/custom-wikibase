#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const all = [...new Set([
  ...lines(execFileSync('rg', ['--files', '--hidden'], { cwd: root, encoding: 'utf8' })),
  ...lines(execFileSync('rg', ['--files', '--no-ignore', 'artifacts/jwb-m3', 'artifacts/jwb-m4', 'artifacts/jwb-m9c', 'artifacts/jwb-j2c2', 'artifacts/jwb-j2d', 'artifacts/jwb-j2e', 'artifacts/jwb-release'], { cwd: root, encoding: 'utf8' }))
])];
const tracked = new Set(lines(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })));
const relevant = all.filter(isRelevant).sort();
const entries = relevant.map((path) => {
  const entry = classify(path);
  return { ...entry, commitGroup: commitGroup(path, entry.classification) };
});
const invalid = entries.filter((entry) => entry.classification === 'UNCLASSIFIED');
if (invalid.length) throw new Error(`UNCLASSIFIED_JWB_FILES:${invalid.map((entry) => entry.currentPath).join(',')}`);

const counts = Object.fromEntries([...new Set(entries.map((entry) => entry.classification))].sort().map((name) => [name, entries.filter((entry) => entry.classification === name).length]));
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, release: '0.1.0-rc.1', futurePrefix: 'components/japan-wikibase', total: entries.length, unclassified: 0, counts, policies: { runtimeState: 'DO_NOT_TRACK_RUNTIME', credentials: 'DO_NOT_TRACK_SECRET', kubeconfig: 'DO_NOT_TRACK_SECRET', dockerVolumes: 'DO_NOT_TRACK_RUNTIME', snapshotScratch: 'DO_NOT_TRACK_GENERATED' }, entries }, null, 2)}\n`);

function isRelevant(path) {
  return /^(?:apps\/(?:query-router|rdf-generation-coordinator|rdf-snapshot-producer|rdf-source-reader|rdf-sync-worker)|packages\/(?:jwb-database|rdf-domain|rdf-sync|runtime-contract)|services\/(?:rdf-backends|rdf-sync)|infrastructure\/japan-wikibase|docs\/japan-wikibase|artifacts\/jwb-|scripts\/jwb[^/]*\.mjs)/u.test(path)
    || /^docs\/adr\/(?:0019|002[0-9]|003[0-7])-/u.test(path)
    || path === 'docs/architecture/japan-wikibase-boundary.md'
    || path === 'docs/design/jwb-m4-sync-state.sql'
    || /^docs\/operations\/japan-wikibase/u.test(path)
    || ['LICENSE.japan-wikibase', 'repository-ownership.json', 'package.json', 'package-lock.json', '.dockerignore', '.gitignore'].includes(path);
}

function classify(path) {
  const common = { currentPath: path, futurePath: futurePath(path), tracked: tracked.has(path), required: true, dependencyNotes: [] };
  if (path === 'package.json' || path === 'package-lock.json' || path === 'repository-ownership.json' || path === '.dockerignore' || path === '.gitignore') return { ...common, classification: 'PLATFORM_OWNED', required: !['.dockerignore', '.gitignore'].includes(path), dependencyNotes: ['shared monorepo file; extract the JWB subset deliberately'] };
  if (path === 'LICENSE.japan-wikibase') return { ...common, classification: 'TRACK_RELEASE_METADATA' };
  if (path.startsWith('artifacts/')) {
    if (/\/(?:summary\.md|audit\.json|backend-support\.json|image-inventory\.json|sbom\.spdx\.json|extraction-manifest\.json|checkpoint-simulation\.json|secret-review\.json|j2g-summary\.(?:json|md))$/u.test(path)) return { ...common, classification: 'TRACK_RELEASE_METADATA' };
    return { ...common, classification: 'DO_NOT_TRACK_GENERATED', required: false, futurePath: null };
  }
  if (path.startsWith('docs/japan-wikibase/')) return { ...common, classification: 'TRACK_DOCS' };
  if (path.startsWith('docs/adr/') || path === 'docs/architecture/japan-wikibase-boundary.md' || path === 'docs/design/jwb-m4-sync-state.sql') return { ...common, classification: 'TRACK_CONTRACT' };
  if (path.startsWith('docs/operations/')) return { ...common, classification: 'TRACK_TEST', required: false, dependencyNotes: ['historical qualification documentation'] };
  if (path.includes('/kubernetes/') || path.endsWith('/compose.yaml') || path.includes('/rdf/compose.rdf-')) return { ...common, classification: 'TRACK_TEST', required: false, dependencyNotes: ['legacy qualification lane; not Standalone RC runtime'] };
  if (/\.test\.(?:js|mjs)$/u.test(path) || /^scripts\/jwb-(?:m\d|j2|rdf-test|oxigraph-update|lifecycle-visibility|post-promotion|semantic-|entrypoint)/u.test(path)) return { ...common, classification: 'TRACK_TEST' };
  if (path.startsWith('packages/runtime-contract/')) return { ...common, classification: 'TRACK_CONTRACT' };
  if (path.startsWith('scripts/')) return { ...common, classification: 'TRACK_TEST', dependencyNotes: ['bounded local product/release tooling'] };
  return { ...common, classification: 'TRACK_PRODUCT' };
}

function futurePath(path) {
  if (path === 'LICENSE.japan-wikibase') return 'LICENSE';
  if (path === 'package.json' || path === 'package-lock.json' || path === '.dockerignore' || path === '.gitignore') return path;
  if (path === 'repository-ownership.json') return 'docs/repository-ownership.json';
  if (path.startsWith('infrastructure/japan-wikibase/')) return `infrastructure/${path.slice('infrastructure/japan-wikibase/'.length)}`;
  if (path.startsWith('docs/operations/')) return `docs/history/${path.slice('docs/operations/'.length)}`;
  if (path.startsWith('artifacts/')) return `docs/qualification/${path.slice('artifacts/'.length)}`;
  return path;
}

function commitGroup(path, classification) {
  if (classification.startsWith('DO_NOT_TRACK')) return null;
  if (classification === 'PLATFORM_OWNED') return '00-shared-monorepo-metadata';
  if (classification === 'TRACK_CONTRACT') return '01-architecture-runtime-contract';
  if (classification === 'TRACK_DOCS') return '07-release-documentation';
  if (classification === 'TRACK_RELEASE_METADATA' || path === 'LICENSE.japan-wikibase') return '08-license-attribution-release-metadata';
  if (classification === 'TRACK_TEST') return '06-qualification-test-infrastructure';
  if (/services\/rdf-backends|compose\.backend-|rdf\/fuseki/u.test(path)) return '04-rdf-backend-adapters-profiles';
  if (/packages\/jwb-database|rebuild|promot|lifecycle/u.test(path)) return '05-generation-lifecycle-tooling';
  if (/^infrastructure\/japan-wikibase\/(?:Dockerfile|LocalSettings|apache|compose\.product|entrypoint|job-runner|composer)/u.test(path)) return '02-core-standalone-product';
  return '03-rdf-sync-query-subsystem';
}

function lines(value) { return value.trim() ? value.trim().split('\n') : []; }
