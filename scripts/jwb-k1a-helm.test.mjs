import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chart = new URL("../infrastructure/helm/custom-wikibase/", import.meta.url);
const read = (path) => readFileSync(new URL(path, chart), "utf8");

test("K1A chart supports only the explicitly qualified profiles", () => {
  const schema = JSON.parse(read("values.schema.json"));
  assert.deepEqual(schema.properties.profile.enum, ["none", "virtuoso"]);
  assert.doesNotMatch(read("values.yaml"), /fuseki|oxigraph/iu);
});

test("K1A chart references an existing Secret and contains no Secret manifest", () => {
  const templates = ["templates/core.yaml", "templates/query-virtuoso.yaml", "templates/network-policy.yaml"]
    .map(read).join("\n");
  assert.doesNotMatch(templates, /kind:\s*Secret\b/u);
  for (const key of ["dbPassword", "dbRootPassword", "adminPassword", "secretKey", "upgradeKey", "queryDbPassword", "rdfAdminPassword"])
    assert.match(templates, new RegExp(`secretKeyRef:.*key: ${key}`, "u"));
  assert.doesNotMatch(read("values.yaml"), /password\s*:/iu);
});

test("K1A Virtuoso migration sequence is finite and fail closed", () => {
  const query = read("templates/query-virtuoso.yaml");
  assert.match(query, /kind: Job[\s\S]*name: jwb-migrate-/u);
  assert.match(query, /backoffLimit: 0/u);
  assert.match(query, /jwb-migrate-cli\.js up/u);
  assert.match(query, /name: wait-migrations[\s\S]*jwb-migrate-cli\.js status/u);
  assert.match(query, /name: wait-bootstrap[\s\S]*jwb-qualification-cli\.js inspect/u);
  assert.doesNotMatch(query, /kubectl|docker\.sock|\/var\/run\/docker/u);
});

test("K1A exposes only logical product Services", () => {
  const query = read("templates/query-virtuoso.yaml");
  assert.match(query, /name: query-router[\s\S]*type: \{\{ \.Values\.service\.queryRouter\.type \}\}/u);
  for (const internal of ["jwb-postgresql", "backend-a", "backend-b"])
    assert.doesNotMatch(query, new RegExp(`name: ${internal}[\\s\\S]{0,180}type:` , "u"));
  assert.match(read("templates/network-policy.yaml"), /kind: NetworkPolicy/u);
});

test("K1A storage classifications preserve the source-of-truth boundary", () => {
  const all = read("templates/core.yaml") + read("templates/query-virtuoso.yaml");
  assert.match(all, /storage-classification: authoritative/u);
  assert.match(all, /storage-classification: query-control/u);
  assert.match(all, /storage-classification: derived-rebuildable/u);
  assert.match(all, /storage-classification: bounded-temporary/u);
});

test("K1A Job Runner keeps the image entrypoint initialization path", () => {
  const core = read("templates/core.yaml");
  const runner = core.split("name: job-runner").at(-1);
  assert.match(runner, /args: \[jwb-job-runner\]/u);
  assert.doesNotMatch(runner, /command: \[jwb-job-runner\]/u);
});

test("K1A probes use the runtime's distinct liveness and readiness endpoints", () => {
  const query = read("templates/query-virtuoso.yaml");
  assert.match(query, /path: \/livez/u);
  assert.match(query, /path: \/readyz/u);
  assert.doesNotMatch(query, /path: \/healthz/u);
});

test("K1A snapshot and coordinator remain bounded opt-in Jobs", () => {
  const jobs = read("templates/qualification-jobs.yaml");
  assert.match(jobs, /kind: Job/u);
  assert.match(jobs, /backoffLimit: 0/u);
  assert.match(jobs, /qualification\.snapshot\.enabled/u);
  assert.match(jobs, /qualification\.coordinator\.enabled/u);
  assert.doesNotMatch(jobs, /gen-c|kubectl|docker\.sock/u);
});
