#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { validateSemanticFixtureManifest } from '../packages/rdf-sync/src/semantic-fixture-manifest.js';

const state = JSON.parse(readFileSync('/private/tmp/japan-wikibase-runtime.json', 'utf8'));
const fixture = validateSemanticFixtureManifest(JSON.parse(readFileSync('/private/tmp/japan-wikibase-semantic-fixture.json', 'utf8')));
if (process.argv.length !== 2 || state.project !== 'japan-wikibase') throw new Error('J2C1B_INVALID_RUNTIME');
const session = await login();
const initialTarget = await api({ action: 'wbgetentities', ids: fixture.targetItem });
if (initialTarget.data.entities?.[fixture.targetItem]?.missing !== undefined) await api({ action: 'undelete', title: `Item:${fixture.targetItem}`, token: session.token, reason: 'J2-C1b retry recovery' }, session.cookie, true);
const description = `post-promotion-${Date.now()}`;
const itemEdit = await edit(fixture.subjectItem, { descriptions: { en: { language: 'en', value: description } } }, 'J2-C1b post-promotion edit');
await waitAsk(`ASK { <http://127.0.0.1:8280/entity/${fixture.subjectItem}> <http://schema.org/description> ?value . FILTER(STR(?value)="${description}") }`, true);
const propertyLabel = `post-promotion-property-${Date.now()}`;
const propertyEdit = await edit(fixture.properties.string, { labels: { en: { language: 'en', value: propertyLabel } } }, 'J2-C1b schema edit');
await waitAsk(`ASK { <http://127.0.0.1:8280/entity/${fixture.properties.string}> <http://www.w3.org/2000/01/rdf-schema#label> ?value . FILTER(STR(?value)="${propertyLabel}") }`, true);
const title = `Item:${fixture.targetItem}`;
const deleted = await api({ action: 'delete', title, token: session.token, reason: 'J2-C1b bounded lifecycle qualification' }, session.cookie, true);
if (!deleted.data.delete?.logid) throw new Error('J2C1B_DELETE_FAILED');
await waitGraph(fixture.targetItem, false);
const restored = await api({ action: 'undelete', title, token: session.token, reason: 'J2-C1b bounded lifecycle qualification' }, session.cookie, true);
if (!restored.data.undelete?.revisions) throw new Error('J2C1B_UNDELETE_FAILED');
await waitGraph(fixture.targetItem, true);
process.stdout.write(`${JSON.stringify({ servingGeneration: 'gen-b', itemEdit: { id: fixture.subjectItem, revision: itemEdit },
  propertyEdit: { id: fixture.properties.string, revision: propertyEdit }, delete: 'PASS', undelete: 'PASS',
  logicalEndpoint: 'http://127.0.0.1:8290/sparql' }, null, 2)}\n`);

async function edit(id, data, summary) { const result = await api({ action: 'wbeditentity', id, token: session.token, data: JSON.stringify(data), summary }, session.cookie, true); const revision = result.data.entity?.lastrevid; if (!revision) throw new Error('J2C1B_EDIT_FAILED'); return Number(revision); }
async function login() { let result = await api({ action: 'query', meta: 'tokens', type: 'login' }); result = await api({ action: 'login', lgname: state.adminUser, lgpassword: state.adminPassword, lgtoken: result.data.query.tokens.logintoken }, result.cookie, true); if (result.data.login?.result !== 'Success') throw new Error('J2C1B_LOGIN_FAILED'); const csrf = await api({ action: 'query', meta: 'tokens' }, result.cookie); return { cookie: csrf.cookie, token: csrf.data.query.tokens.csrftoken }; }
async function waitAsk(query, expected) { for (let attempt = 0; attempt < 120; attempt += 1) { try { const response = await fetch('http://127.0.0.1:8290/sparql', { method: 'POST', headers: { 'content-type': 'application/sparql-query', accept: 'application/sparql-results+json' }, body: query }); if (response.ok && (await response.json()).boolean === expected) return; } catch {} await new Promise(resolve => setTimeout(resolve, 500)); } throw new Error('J2C1B_SPARQL_CONVERGENCE_TIMEOUT'); }
async function waitGraph(entityId, expected) { await waitAsk(`ASK { <http://127.0.0.1:8280/entity/${entityId}> ?p ?o }`, expected); }
async function api(parameters, cookie = '', post = false) { const values = { format: 'json', formatversion: '2', ...parameters }; const response = post ? await fetch('http://127.0.0.1:8280/api.php', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: new URLSearchParams(values) }) : await fetch(`http://127.0.0.1:8280/api.php?${new URLSearchParams(values)}`, { headers: cookie ? { cookie } : {} }); if (!response.ok) throw new Error(`J2C1B_API_HTTP_${response.status}`); const cookies = new Map(cookie.split('; ').filter(Boolean).map(value => [value.split('=', 1)[0], value])); for (const value of response.headers.getSetCookie?.() ?? []) { const pair = value.split(';', 1)[0]; cookies.set(pair.split('=', 1)[0], pair); } return { data: await response.json(), cookie: [...cookies.values()].join('; ') }; }
