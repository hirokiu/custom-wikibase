import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRouterConfig } from './config.js';

test('router runtime accepts only bounded local durable configuration', () => {
  const value = loadRouterConfig({ JWB_ROUTER_BACKEND: 'virtuoso', JWB_ROUTER_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:54321/m9', JWB_ROUTER_PORT: '19201' });
  assert.equal(value.port, 19201);
  assert.equal(loadRouterConfig({JWB_ROUTER_RUNTIME:'kubernetes',JWB_ROUTER_BACKEND:'virtuoso',JWB_ROUTER_DATABASE_URL:'postgresql://user:pass@controller-postgres.jwb-system.svc.cluster.local:5432/jwb'}).runtimeType,'kubernetes');
  assert.equal(loadRouterConfig({JWB_ROUTER_RUNTIME:'standalone-compose',JWB_ROUTER_BACKEND:'virtuoso',JWB_ROUTER_DATABASE_URL:'postgresql://user:pass@jwb-postgresql:5432/japan_wikibase_query'}).runtimeType,'standalone-compose');
  const mixed=loadRouterConfig({JWB_ROUTER_BACKEND_A:'virtuoso',JWB_ROUTER_BACKEND_B:'oxigraph',JWB_ROUTER_DATABASE_URL:'postgresql://user:pass@127.0.0.1:54321/m9'});assert.equal(mixed.backendType,null);assert.equal(mixed.generationBackends['gen-b'],'oxigraph');
  assert.throws(() => loadRouterConfig({ JWB_ROUTER_BACKEND: 'virtuoso', JWB_ROUTER_DATABASE_URL: 'postgresql://u:p@utirik:5432/m9' }), /local PostgreSQL/u);
  assert.throws(() => loadRouterConfig({ JWB_ROUTER_BACKEND: 'other', JWB_ROUTER_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/m9' }), /allowlisted/u);
});
test('runtime discovery URLs are explicit public endpoints',()=>{const value=loadRouterConfig({JWB_ROUTER_RUNTIME:'standalone-compose',JWB_ROUTER_BACKEND:'virtuoso',JWB_ROUTER_DATABASE_URL:'postgresql://u:p@jwb-postgresql:5432/japan_wikibase_query',JWB_CANONICAL_PUBLIC_URL:'https://cw-a.wb.example.org',JWB_PUBLIC_QUERY_URL:'https://cw-a-query.wb.example.org/sparql'});assert.equal(value.canonicalPublicUrl,'https://cw-a.wb.example.org');assert.equal(value.publicQueryUrl,'https://cw-a-query.wb.example.org/sparql');assert.throws(()=>loadRouterConfig({...value,JWB_ROUTER_RUNTIME:'standalone-compose',JWB_ROUTER_BACKEND:'virtuoso',JWB_ROUTER_DATABASE_URL:'postgresql://u:p@jwb-postgresql:5432/japan_wikibase_query',JWB_PUBLIC_QUERY_URL:'https://attacker.example/update'}),/public query/u);});
