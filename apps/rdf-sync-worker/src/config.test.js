import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";
const valid = {
  JWB_SYNC_BACKEND: "fuseki-tdb2",
  JWB_SYNC_GENERATION_ID: "gen-a",
  JWB_SYNC_DATABASE_URL: "postgresql://sync:secret@127.0.0.1:15432/jwb_sync",
};
test("accepts only bounded local runtime configuration", () => {
  assert.equal(loadConfig(valid).pageSize, 50);
  assert.equal(
    loadConfig(valid).normalizationModel,
    "jwb-rdf-normalization-v1",
  );
  assert.throws(
    () =>
      loadConfig({ ...valid, JWB_SYNC_SOURCE_URL: "https://utirik.example" }),
    /local/u,
  );
  assert.throws(
    () => loadConfig({ ...valid, JWB_SYNC_BACKEND: "shell" }),
    /allowlisted/u,
  );
  assert.throws(
    () => loadConfig({ ...valid, JWB_SYNC_PAGE_SIZE: "1000" }),
    /range/u,
  );
});
test("requires one fixed physical generation", () => {
  assert.equal(loadConfig(valid).generationId, "gen-a");
  assert.throws(
    () => loadConfig({ ...valid, JWB_SYNC_GENERATION_ID: "gen-user" }),
    /generation/u,
  );
});
test("accepts only fixed qualification crash points", () => {
  assert.equal(
    loadConfig({ ...valid, JWB_SYNC_CRASH_AT: "AFTER_BACKEND_UPDATE" })
      .crashAt,
    "AFTER_BACKEND_UPDATE",
  );
  assert.throws(
    () => loadConfig({ ...valid, JWB_SYNC_CRASH_AT: "USER_INPUT" }),
    /allowlisted/u,
  );
});
test('standalone worker accepts only fixed product DNS',()=>{const standalone={...valid,JWB_SYNC_RUNTIME:'standalone-compose',JWB_SYNC_SOURCE_URL:'http://wikibase',JWB_SYNC_DATABASE_URL:'postgresql://sync:secret@jwb-postgresql:5432/japan_wikibase_query'};assert.equal(loadConfig(standalone).runtimeType,'standalone-compose');assert.throws(()=>loadConfig({...standalone,JWB_SYNC_SOURCE_URL:'http://foreign'}),/local/u);});
test("accepts only the fixed Kubernetes data-plane endpoints", () => {
  const kubernetes = {
    ...valid,
    JWB_SYNC_RUNTIME: "kubernetes",
    JWB_SYNC_SOURCE_URL:
      "http://japan-wikibase.jwb-instance-local-01.svc.cluster.local",
    JWB_SYNC_DATABASE_URL:
      "postgresql://sync:secret@controller-postgres.jwb-system.svc.cluster.local:5432/jwb",
  };
  assert.equal(loadConfig(kubernetes).runtimeType, "kubernetes");
  assert.throws(
    () => loadConfig({ ...kubernetes, JWB_SYNC_SOURCE_URL: "http://utirik" }),
    /local/u,
  );
  assert.throws(
    () => loadConfig({ ...kubernetes, JWB_SYNC_DATABASE_URL: "postgresql://sync:secret@postgres.default.svc.cluster.local:5432/jwb" }),
    /trusted/u,
  );
});
