import assert from "node:assert/strict";
import test from "node:test";
import { loadSourceReaderConfig } from "./config.js";
test("source reader accepts only fixed local source and PostgreSQL", () => {
  const value = loadSourceReaderConfig({
    JWB_SOURCE_READER_DATABASE_URL: "postgresql://u:p@127.0.0.1:55432/m9b",
  });
  assert.equal(value.sourceIdentity, "jwb-local");
  assert.throws(
    () =>
      loadSourceReaderConfig({
        JWB_SOURCE_READER_DATABASE_URL: "postgresql://u:p@utirik:5432/m9b",
      }),
    /local PostgreSQL/u,
  );
  assert.throws(
    () =>
      loadSourceReaderConfig({
        JWB_SOURCE_READER_URL: "https://example.org",
        JWB_SOURCE_READER_DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/m9b",
      }),
    /local HTTP/u,
  );
});
test("source reader accepts the one fixed Kubernetes source identity", () => {
  const config = loadSourceReaderConfig({
    JWB_SOURCE_READER_RUNTIME: "kubernetes",
    JWB_SOURCE_READER_URL:
      "http://japan-wikibase.jwb-instance-local-01.svc.cluster.local",
    JWB_SOURCE_READER_DATABASE_URL:
      "postgresql://reader:secret@controller-postgres.jwb-system.svc.cluster.local:5432/jwb",
  });
  assert.equal(config.runtimeType, "kubernetes");
});
test("source reader standalone mode accepts only product service DNS",()=>{const config=loadSourceReaderConfig({JWB_SOURCE_READER_RUNTIME:'standalone-compose',JWB_SOURCE_READER_URL:'http://wikibase',JWB_SOURCE_READER_DATABASE_URL:'postgresql://reader:secret@jwb-postgresql:5432/japan_wikibase_query'});assert.equal(config.runtimeType,'standalone-compose');assert.throws(()=>loadSourceReaderConfig({JWB_SOURCE_READER_RUNTIME:'standalone-compose',JWB_SOURCE_READER_URL:'http://foreign',JWB_SOURCE_READER_DATABASE_URL:'postgresql://reader:secret@jwb-postgresql:5432/japan_wikibase_query'}),/local HTTP/u);});
