#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import * as k8s from "@kubernetes/client-node";
import { KubernetesGenerationDriver } from "../services/rdf-sync/src/kubernetes-generation-driver.js";
import { SparqlHttpBackend } from "../services/rdf-backends/src/sparql-http-backend.js";
import { RDF_BACKEND_PROFILES } from "../services/rdf-backends/src/profiles.js";
import { GenerationDatasetLoader } from "../services/rdf-sync/src/generation-dataset-loader.js";
import { PostgresGenerationSyncRepository } from "../services/rdf-sync/src/postgres-generation-sync-repository.js";
import { PostgresGenerationCoordinatorRepository } from "../services/rdf-sync/src/postgres-generation-coordinator-repository.js";
import { normalizeWikibaseRdf } from "../packages/rdf-sync/src/canonical-rdf-normalizer.js";
import {
  datasetToNQuads,
  partitionWikibaseSnapshot,
} from "../packages/rdf-sync/src/dataset-partition.js";
import { diffCanonicalRdfDatasets } from "../packages/rdf-sync/src/rdf-canonicalization.js";
const KUBECONFIG = "/tmp/wfp-jwb-m10-kubeconfig.yaml",
  CONTEXT = "k3d-wfp-jwb-m10",
  INSTANCE = "jwb-instance-local-01",
  SYSTEM = "jwb-system",
  QUERY = "jwb-query-local",
  SOURCE = "jwb-m10b",
  children = [];
guard();
const manifest = JSON.parse(
    readFileSync("/tmp/wfp-jwb-m10b-source-evidence.json", "utf8"),
  ).manifest,
  kc = kube(),
  core = kc.makeApiClient(k8s.CoreV1Api),
  apps = kc.makeApiClient(k8s.AppsV1Api),
  driver = new KubernetesGenerationDriver({
    backendType: "virtuoso",
    core,
    apps,
    storageSize: "512Mi",
  }),
  databaseUrl = decode(
    unwrap(
      await core.readNamespacedSecret({
        namespace: SYSTEM,
        name: "controller-postgres",
      }),
    ).data.url,
  ),
  password = decode(
    unwrap(
      await core.readNamespacedSecret({
        namespace: QUERY,
        name: "jwb-virtuoso-admin",
      }),
    ).data.password,
  ),
  dbf = forward(SYSTEM, "service/controller-postgres", 25432, 5432),
  webf = forward(INSTANCE, "service/japan-wikibase", 28180, 80);
children.push(dbf, webf);
let pool, bf;
try {
  await sleep(750);
  pool = new pg.Pool({
    connectionString: databaseUrl.replace(
      "controller-postgres.jwb-system.svc.cluster.local:5432",
      "127.0.0.1:25432",
    ),
    max: 8,
  });
  await pool.query("SELECT 1");
  const prerequisite = (
    await pool.query(
      "SELECT p.generation_id,p.version,g.state,g.backend_type FROM rdf_serving_pointer p JOIN rdf_generation g ON g.source_identity=p.source_identity AND g.generation_id=p.generation_id WHERE p.query_service_id='jwb-local-query' AND p.source_identity=$1",
      [SOURCE],
    )
  ).rows[0];
  assert.deepEqual(
    {
      generation: prerequisite?.generation_id,
      state: prerequisite?.state,
      backend: prerequisite?.backend_type,
    },
    { generation: "gen-a", state: "SERVING", backend: "virtuoso" },
    "M10C B requires independently qualified serving generation A",
  );
  const credentials = unwrap(
      await core.readNamespacedSecret({
        namespace: INSTANCE,
        name: "jwb-m10b-qualification",
      }),
    ),
    session = await login(
      decode(credentials.data.adminUser),
      decode(credentials.data.adminPassword),
    ),
    oldMarker = `m10c-old-${Date.now()}`,
    newMarker = `m10c-new-${Date.now()}`;
  await post(session, {
    action: "wbsetlabel",
    id: manifest.subjectItem,
    language: "en",
    value: oldMarker,
    summary: "M10C old serving marker",
  });
  await waitSync("gen-a", await cursor());
  const c0 = await cursor();
  const coordinatorRepository = new PostgresGenerationCoordinatorRepository({
      pool,
    }),
    operation = await coordinatorRepository.request({
      requestKey: `m10c:virtuoso:${manifest.datasetRunId}`,
      sourceIdentity: SOURCE,
      queryServiceId: "jwb-local-query",
      candidateGenerationId: "gen-b",
      backendType: "virtuoso",
      reason: "MANUAL_LOCAL_QUALIFICATION",
      snapshotCursor: c0,
      targetCursor: c0,
    });
  await waitOperation(operation.id, "LOADING_SNAPSHOT");
  await healthy("gen-b");
  const pod = await genPod("gen-b");
  bf = forward(QUERY, `pod/${pod.metadata.name}`, 28891, 8890);
  children.push(bf);
  await waitHttp("http://127.0.0.1:28891/sparql");
  const backend = virtuoso(28891),
    rdf = dump();
  await backend.initialize({ instanceId: "m10b-gen-b" });
  const repo = new PostgresGenerationSyncRepository({
    pool,
    sourceIdentity: SOURCE,
    generationId: "gen-b",
  });
  await repo.initialize({ snapshotCursor: c0 });
  await new GenerationDatasetLoader({ backend, repository: repo }).loadSnapshot(
    { rdf },
  );
  await repo.markCurrent();
  const b0 = await equality(backend, "gen-b", rdf);
  assert.deepEqual(b0.diff, { canonicalOnly: [], generationOnly: [] });
  await deployBWorker();
  await apps.patchNamespacedDeployment({
    namespace: INSTANCE,
    name: "rdf-sync-worker",
    body: [{ op: "replace", path: "/spec/replicas", value: 0 }],
  });
  await post(session, {
    action: "wbsetlabel",
    id: manifest.subjectItem,
    language: "en",
    value: newMarker,
    summary: "M10B B catchup",
  });
  await post(session, {
    action: "wbsetlabel",
    id: manifest.properties.string,
    language: "en",
    value: `M10B schema ${Date.now()}`,
    summary: "M10B schema catchup",
  });
  const title = `Item:${manifest.deleteItem}`;
  await post(session, { action: "delete", title, reason: "M10B delete" });
  await post(session, { action: "undelete", title, reason: "M10B undelete" });
  const target = await cursor();
  await waitSync("gen-b", target);
  const fenceA = await fence("gen-a", manifest.subjectItem),
    fenceB = await fence("gen-b", manifest.subjectItem),
    restored = await fence("gen-b", manifest.deleteItem),
    syncB = (
      await pool.query(
        "SELECT state,schema_state FROM rdf_generation_sync WHERE source_identity=$1 AND generation_id='gen-b'",
        [SOURCE],
      )
    ).rows[0];
  assert.equal(restored.state, "CURRENT");
  assert.equal(syncB.schema_state, "CURRENT");
  const eq = await equality(backend, "gen-b");
  assert.deepEqual(eq.diff, { canonicalOnly: [], generationOnly: [] });
  const before = await servingPointer(),
    visibility = startVisibilitySampler({ oldMarker, newMarker });
  await visibility.ready;
  await visibility.waitFor("OLD_COMPLETE");
  await pool.query(
    "UPDATE rdf_generation SET state='READY',validation_status='VALID',validation_checksum=$3,catchup_timestamp=$4,catchup_rcid=$5 WHERE source_identity=$1 AND generation_id=$2",
    [SOURCE, "gen-b", "1".repeat(64), target.timestamp, target.rcid],
  );
  await waitOperation(operation.id, "ROLLBACK_PROTECTED");
  await sleep(1000);
  const samples = await visibility.stop(),
    promoted = await servingPointer(),
    journal = (
      await pool.query(
        "SELECT state,phase,expected_pointer_version,resulting_pointer_version FROM rdf_generation_promotion WHERE operation_id=$1",
        [operation.id],
      )
    ).rows[0];
  assert.equal(promoted.generation_id, "gen-b");
  assert.equal(Number(promoted.version), Number(before.version) + 1);
  assert.deepEqual(
    samples.filter((value) => ["EMPTY", "PARTIAL", "INVALID"].includes(value)),
    [],
  );
  assert.ok(samples.includes("OLD_COMPLETE"));
  assert.ok(samples.includes("NEW_COMPLETE"));
  await routers();
  await post(session, {
    action: "wbsetlabel",
    id: manifest.subjectItem,
    language: "ja",
    value: `M10B post promotion ${Date.now()}`,
    summary: "M10B post promotion",
  });
  const postTarget = await cursor();
  await waitSync("gen-b", postTarget);
  const finalEq = await equality(backend, "gen-b");
  assert.deepEqual(finalEq.diff, { canonicalOnly: [], generationOnly: [] });
  console.log(
    JSON.stringify(
      {
        status: "M10B_VIRTUOSO_AB_REAL_SYNC_QUALIFIED",
        c0,
        target,
        postTarget,
        independentFences: { a: fenceA, b: fenceB },
        restored,
        syncB,
        bEquality: summary(eq),
        finalEquality: summary(finalEq),
        promotion: { operationId: operation.id, before, promoted, journal },
        visibility: summarizeVisibility(samples),
      },
      null,
      2,
    ),
  );
} finally {
  await apps
    .patchNamespacedDeployment({
      namespace: INSTANCE,
      name: "rdf-sync-worker",
      body: [{ op: "replace", path: "/spec/replicas", value: 1 }],
    })
    .catch(() => {});
  if (pool) await pool.end().catch(() => {});
  for (const c of children.reverse()) c?.kill("SIGTERM");
}
async function deployBWorker() {
  const current = unwrap(
      await apps.readNamespacedDeployment({
        namespace: INSTANCE,
        name: "rdf-sync-worker",
      }),
    ),
    body = structuredClone(current);
  for (const key of [
    "resourceVersion",
    "uid",
    "creationTimestamp",
    "generation",
    "managedFields",
  ])
    delete body.metadata[key];
  body.metadata.name = "rdf-sync-worker-b";
  body.spec.selector.matchLabels["app.kubernetes.io/name"] =
    "rdf-sync-worker-b";
  body.spec.template.metadata.labels["app.kubernetes.io/name"] =
    "rdf-sync-worker-b";
  const container = body.spec.template.spec.containers[0];
  container.env.find((v) => v.name === "JWB_SYNC_GENERATION_ID").value =
    "gen-b";
  container.env.find((v) => v.name === "JWB_SYNC_HEALTH_PORT").value = "9192";
  container.ports[0].containerPort = 9192;
  try {
    await apps.createNamespacedDeployment({ namespace: INSTANCE, body });
  } catch (e) {
    if (code(e) !== 409) throw e;
  }
  for (let i = 0; i < 300; i++) {
    const d = unwrap(
      await apps.readNamespacedDeployment({
        namespace: INSTANCE,
        name: "rdf-sync-worker-b",
      }),
    );
    if (d.status?.availableReplicas === 1) return;
    await sleep(500);
  }
  throw new Error("B worker timeout");
}
function dump() {
  const pod = capture("kubectl", [
    ...base(),
    "-n",
    INSTANCE,
    "get",
    "pod",
    "-l",
    "app.kubernetes.io/name=japan-wikibase",
    "-o",
    "jsonpath={.items[0].metadata.name}",
  ]).trim();
  return capture("kubectl", [
    ...base(),
    "-n",
    INSTANCE,
    "exec",
    pod,
    "--",
    "php",
    "extensions/Wikibase/repo/maintenance/dumpRdf.php",
    "--format",
    "nt",
    "--flavor",
    "full-dump",
  ]);
}
async function equality(backend, id, rdf = dump()) {
  const graphs = (
      await pool.query(
        "SELECT graph_iri FROM rdf_generation_graph WHERE source_identity=$1 AND generation_id=$2 ORDER BY graph_iri",
        [SOURCE, id],
      )
    ).rows.map((v) => v.graph_iri),
    out = [];
  for (const graph of graphs) {
    const r = await fetch(backend.queryUrl, {
      method: "POST",
      headers: {
        accept: "application/n-triples",
        "content-type": "application/sparql-query",
      },
      body: `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${graph}> { ?s ?p ?o } }`,
    });
    for (const line of (await r.text()).trim().split("\n").filter(Boolean))
      out.push(`${line.slice(0, -1).trimEnd()} <${graph}> .`);
  }
  const expected = datasetToNQuads(
    partitionWikibaseSnapshot(
      normalizeWikibaseRdf(rdf, { sourceKind: "FULL_DUMP" }).rdf,
    ),
  );
  return {
    graphs: graphs.length,
    diff: diffCanonicalRdfDatasets(expected, out.sort().join("\n") + "\n"),
  };
}
async function cursor() {
  const e = (
    await api({
      action: "query",
      list: "recentchanges",
      rclimit: "1",
      rcdir: "older",
      rcnamespace: "120|122",
      rcprop: "ids|timestamp",
    })
  ).data.query.recentchanges[0];
  return { sourceIdentity: SOURCE, timestamp: e.timestamp, rcid: e.rcid };
}
async function waitSync(id, target) {
  for (let i = 0; i < 600; i++) {
    const r = (
      await pool.query(
        "SELECT catchup_cursor_timestamp,catchup_cursor_rcid FROM rdf_generation_sync WHERE source_identity=$1 AND generation_id=$2",
        [SOURCE, id],
      )
    ).rows[0];
    if (
      r?.catchup_cursor_timestamp &&
      (Date.parse(r.catchup_cursor_timestamp) > Date.parse(target.timestamp) ||
        (Date.parse(r.catchup_cursor_timestamp) ===
          Date.parse(target.timestamp) &&
          Number(r.catchup_cursor_rcid) >= target.rcid))
    )
      return;
    await sleep(500);
  }
  throw new Error(`sync timeout ${id}`);
}
async function fence(id, entity) {
  return (
    await pool.query(
      "SELECT indexed_revision,state FROM rdf_generation_entity_revision WHERE source_identity=$1 AND generation_id=$2 AND entity_id=$3",
      [SOURCE, id, entity],
    )
  ).rows[0];
}
async function login(user, password) {
  let r = await api({ action: "query", meta: "tokens", type: "login" });
  r = await api(
    {
      action: "login",
      lgname: user,
      lgpassword: password,
      lgtoken: r.data.query.tokens.logintoken,
    },
    r.cookie,
    true,
  );
  const c = await api({ action: "query", meta: "tokens" }, r.cookie);
  return { cookie: c.cookie, token: c.data.query.tokens.csrftoken };
}
async function post(s, v) {
  const r = await api({ ...v, token: s.token }, s.cookie, true);
  if (r.data.error) throw new Error(JSON.stringify(r.data.error));
  return r.data;
}
async function api(v, cookie = "", postRequest = false) {
  const p = { format: "json", formatversion: "2", ...v },
    r = postRequest
      ? await fetch("http://127.0.0.1:28180/api.php", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie,
          },
          body: new URLSearchParams(p),
        })
      : await fetch(
          `http://127.0.0.1:28180/api.php?${new URLSearchParams(p)}`,
          { headers: cookie ? { cookie } : {} },
        ),
    m = new Map(
      cookie
        .split("; ")
        .filter(Boolean)
        .map((x) => [x.split("=", 1)[0], x]),
    );
  for (const x of r.headers.getSetCookie?.() ?? []) {
    const q = x.split(";", 1)[0];
    m.set(q.split("=", 1)[0], q);
  }
  return { data: await r.json(), cookie: [...m.values()].join("; ") };
}
async function waitOperation(id, expected) {
  for (let i = 0; i < 600; i++) {
    const value = (
      await pool.query(
        "SELECT state,error_code FROM rdf_coordinator_operation WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (value?.state === expected) return value;
    if (["FAILED", "AMBIGUOUS"].includes(value?.state))
      throw new Error(`coordinator ${value.state}: ${value.error_code ?? "unknown"}`);
    await sleep(250);
  }
  throw new Error(`coordinator timeout: ${expected}`);
}
async function servingPointer() {
  return (
    await pool.query(
      "SELECT generation_id,previous_generation_id,version FROM rdf_serving_pointer WHERE query_service_id='jwb-local-query'",
    )
  ).rows[0];
}
function startVisibilitySampler({ oldMarker, newMarker }) {
  const child = forward(SYSTEM, "service/query-router", 28081, 8080),
    samples = [];
  children.push(child);
  let stopping = false;
  const ready = waitHttpOk("http://127.0.0.1:28081/readyz"),
    running = (async () => {
    await ready;
    while (!stopping) {
      samples.push(await visibilitySample(oldMarker, newMarker));
      await sleep(25);
    }
  })();
  return {
    ready,
    async waitFor(expected) {
      for (let i = 0; i < 200; i++) {
        if (samples.includes(expected)) return;
        await sleep(25);
      }
      throw new Error(
        `visibility timeout: ${expected} ${JSON.stringify(summarizeVisibility(samples))}`,
      );
    },
    async stop() {
      stopping = true;
      await running;
      child.kill("SIGTERM");
      return samples;
    },
  };
}
async function visibilitySample(oldMarker, newMarker) {
  try {
    const response = await fetch("http://127.0.0.1:28081/sparql", {
      method: "POST",
      headers: {
        "content-type": "application/sparql-query",
        accept: "application/sparql-results+json",
      },
      body: `SELECT ?value WHERE { ?entity <http://www.w3.org/2000/01/rdf-schema#label> ?value FILTER((LANG(?value)="en") && (STR(?value)="${oldMarker}" || STR(?value)="${newMarker}")) }`,
    });
    if (!response.ok) return "INVALID";
    const data = await response.json(),
      values = new Set(
        (data.results?.bindings ?? []).map((value) => value.value?.value),
      ),
      old = values.has(oldMarker),
      fresh = values.has(newMarker);
    if (old && !fresh) return "OLD_COMPLETE";
    if (!old && fresh) return "NEW_COMPLETE";
    if (!old && !fresh) return "EMPTY";
    return "PARTIAL";
  } catch {
    return "CONNECTION_ERROR";
  }
}
function summarizeVisibility(samples) {
  return Object.fromEntries(
    [
      "OLD_COMPLETE",
      "NEW_COMPLETE",
      "EMPTY",
      "PARTIAL",
      "INVALID",
      "CONNECTION_ERROR",
    ].map((key) => [key, samples.filter((value) => value === key).length]),
  );
}
async function routers() {
  const child = forward(SYSTEM, "service/query-router", 28080, 8080);
  children.push(child);
  await waitHttp("http://127.0.0.1:28080/readyz");
  const expected = (
      await pool.query(
        "SELECT version FROM rdf_serving_pointer WHERE query_service_id='jwb-local-query'",
      )
    ).rows[0].version,
    r = await fetch("http://127.0.0.1:28080/sparql", {
      method: "POST",
      headers: {
        "content-type": "application/sparql-query",
        accept: "application/sparql-results+json",
      },
      body: "ASK { ?s ?p ?o }",
    });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-jwb-pointer-version"), String(expected));
  assert.equal(r.headers.get("x-jwb-generation-id"), null);
}
function virtuoso(port) {
  return new SparqlHttpBackend({
    queryUrl: `http://127.0.0.1:${port}/sparql`,
    updateUrl: `http://127.0.0.1:${port}/sparql-auth`,
    graphStoreUrl: `http://127.0.0.1:${port}/sparql-graph-crud-auth`,
    digestAuth: { username: "dba", password },
    metadata: RDF_BACKEND_PROFILES.virtuoso,
  });
}
async function healthy(id) {
  for (let i = 0; i < 600; i++) {
    if (
      (await driver.getGenerationHealth({ generationId: id })).status ===
      "healthy"
    )
      return;
    await sleep(500);
  }
  throw new Error("health timeout");
}
async function genPod(id) {
  for (let i = 0; i < 600; i++) {
    const p = unwrap(
      await core.listNamespacedPod({
        namespace: QUERY,
        labelSelector: `wikibase-federation.lodac.nii.ac.jp/generation-id=${id},wikibase-federation.lodac.nii.ac.jp/backend-type=virtuoso`,
      }),
    ).items.find((x) =>
      x.status.conditions?.some(
        (c) => c.type === "Ready" && c.status === "True",
      ),
    );
    if (p) return p;
    await sleep(500);
  }
  throw new Error("pod timeout");
}
function guard() {
  if (!existsSync(KUBECONFIG)) throw new Error("kubeconfig missing");
  const c = capture("kubectl", [...base(), "config", "current-context"]),
    s = capture("kubectl", [
      ...base(),
      "config",
      "view",
      "--minify",
      "-o",
      "jsonpath={.clusters[0].cluster.server}",
    ]);
  if (
    c.trim() !== CONTEXT ||
    !/127\.0\.0\.1|localhost|0\.0\.0\.0/u.test(s) ||
    /utirik|prod/iu.test(s)
  )
    throw new Error("unsafe target");
}
function kube() {
  const k = new k8s.KubeConfig();
  k.loadFromFile(KUBECONFIG);
  k.setCurrentContext(CONTEXT);
  return k;
}
function base() {
  return ["--kubeconfig", KUBECONFIG, "--context", CONTEXT];
}
function forward(ns, target, l, r) {
  return spawn(
    "kubectl",
    [...base(), "-n", ns, "port-forward", target, `${l}:${r}`],
    { stdio: "ignore" },
  );
}
async function waitHttp(url) {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(url)).status) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("HTTP timeout");
}
async function waitHttpOk(url) {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("HTTP readiness timeout");
}
function capture(c, a) {
  return execFileSync(c, a, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function decode(v) {
  return Buffer.from(v, "base64").toString();
}
function unwrap(v) {
  return v?.body ?? v;
}
function code(e) {
  return e?.statusCode ?? e?.response?.statusCode ?? e?.code;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function summary(v) {
  return {
    graphs: v.graphs,
    canonicalOnly: v.diff.canonicalOnly.length,
    generationOnly: v.diff.generationOnly.length,
  };
}
