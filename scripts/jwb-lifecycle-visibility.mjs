#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { validateSemanticFixtureManifest } from '../packages/rdf-sync/src/semantic-fixture-manifest.js';

const action = process.argv[2];
if (!['promote', 'rollback'].includes(action) || process.argv.length !== 3) throw new Error('J2C1B_FIXED_VISIBILITY_ACTION_REQUIRED');
const fixture = validateSemanticFixtureManifest(JSON.parse(readFileSync('/private/tmp/japan-wikibase-semantic-fixture.json', 'utf8')));
const query = `ASK { <http://127.0.0.1:8280/entity/${fixture.subjectItem}> ?p ?o . <http://127.0.0.1:8280/entity/${fixture.targetItem}> ?tp ?to . <http://127.0.0.1:8280/entity/${fixture.properties.string}> ?sp ?so . }`;
const initial = await sample();
if (!initial.ok) throw new Error('J2C1B_INITIAL_SAMPLE_FAILED');
const oldVersion = initial.version;
const child = spawn(process.execPath, ['scripts/jwb-product.mjs', action], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', error = '', finished = false;
child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { error += value; });
child.once('close', code => { finished = true; if (code !== 0) error += ` exit=${code}`; });
const counts = { OLD_COMPLETE: 0, NEW_COMPLETE: 0, EMPTY: 0, PARTIAL: 0, INVALID: 0, CONNECTION_ERROR: 0 };
for (let index = 0; index < 200 && (!finished || index < 20); index += 1) { const value = await sample(); counts[classify(value, oldVersion)] += 1; await new Promise(resolve => setTimeout(resolve, 10)); }
if (error || !finished) throw new Error(`J2C1B_LIFECYCLE_COMMAND_FAILED:${error.slice(0, 200)}`);
if (counts.EMPTY || counts.PARTIAL || counts.INVALID || counts.CONNECTION_ERROR) throw new Error(`J2C1B_VISIBILITY_FAILED:${JSON.stringify(counts)}`);
process.stdout.write(`${JSON.stringify({ action, logicalEndpoint: 'http://127.0.0.1:8290/sparql', oldPointerVersion: oldVersion, visibility: counts, operationOutput: output.trim().split('\n').at(-1) }, null, 2)}\n`);

async function sample() { try { const response = await fetch('http://127.0.0.1:8290/sparql', { method: 'POST', headers: { 'content-type': 'application/sparql-query', accept: 'application/sparql-results+json' }, body: query }); if (!response.ok) return { ok: false, status: response.status }; const body = await response.json(); return { ok: true, complete: body.boolean === true, version: Number(response.headers.get('x-jwb-pointer-version')) }; } catch { return { connectionError: true }; } }
function classify(value, oldVersion) { if (value.connectionError) return 'CONNECTION_ERROR'; if (!value.ok) return 'INVALID'; if (!value.complete) return 'PARTIAL'; return value.version === oldVersion ? 'OLD_COMPLETE' : 'NEW_COMPLETE'; }
