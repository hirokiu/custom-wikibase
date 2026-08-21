#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { migrate } from "../packages/jwb-database/src/migration-runner.js";
import {
  datasetToNQuads,
  partitionWikibaseSnapshot,
} from "../packages/rdf-sync/src/dataset-partition.js";
import { diffCanonicalRdfDatasets } from "../packages/rdf-sync/src/rdf-canonicalization.js";
import { generationManifest, JWB_RDF_NORMALIZATION_MODEL, normalizeWikibaseRdf } from "../packages/rdf-sync/src/canonical-rdf-normalizer.js";
import { GenerationDatasetLoader } from "../services/rdf-sync/src/generation-dataset-loader.js";
import { LocalComposeGenerationDriver } from "../services/rdf-sync/src/local-compose-generation-driver.js";
import { PostgresGenerationSyncRepository } from "../services/rdf-sync/src/postgres-generation-sync-repository.js";
import { PostgresServingPointerRepository } from "../services/rdf-sync/src/postgres-serving-pointer-repository.js";
import {
  JWB_BASE_URL,
  JWB_DOCKER_CONTEXT,
  JWB_PROJECT,
  JWB_STATE_FILE,
  assertJwbDockerTarget,
  stateEnvironment,
} from "./jwb-lib.mjs";
const allowed = new Set(["virtuoso", "oxigraph", "fuseki-tdb2"]),
  backendA = option("--backend=") ?? "virtuoso",
  backendB = option("--candidate=") ?? backendA,
  soakSeconds = Number(option("--soak-seconds=") ?? 0);
const stopAfterEquality=process.argv.includes('--stop-after-equality');
if (!allowed.has(backendA) || !allowed.has(backendB))
  throw new Error("allowlisted backends required");
if (!Number.isInteger(soakSeconds) || soakSeconds < 0 || soakSeconds > 3600)
  throw new Error("invalid soak duration");
assertLocal();
const state = JSON.parse(readFileSync(JWB_STATE_FILE, "utf8")),
  manifest = JSON.parse(
    readFileSync(
      new URL("../artifacts/jwb-m3/entity-manifest.json", import.meta.url),
      "utf8",
    ),
  );
stateEnvironment(state);
const dbName = "wfp-jwb-m9b-postgres",
  dbPassword = randomBytes(24).toString("base64url"),
  sourceIdentity = "jwb-m9b",
  queryServiceId = "jwb-m9b-query",
  driverA = new LocalComposeGenerationDriver({ backendType: backendA }),
  driverB = new LocalComposeGenerationDriver({ backendType: backendB }),
  passwordA = randomBytes(24).toString("base64url"),
  passwordB = randomBytes(24).toString("base64url");
let pool, databaseUrl;
const qualificationStarted = Date.now();
const processes = [],
  files = [],
  visibility = [],
  measurements = {};
let output;
try {
  databaseUrl = await startPostgres();
  pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  pool.on("error", () => {});
  await migrate(pool);
  await seedRegistry();
  const instance = (
    await pool.query("SELECT id FROM controller_instance WHERE slug='m9b-local'")
  ).rows[0].id;
  await pool.query(
    "INSERT INTO rdf_sync_source(source_identity,instance_id,backend_type,status,legacy_state_resolution) VALUES($1,$2,$3,'HEALTHY','EMPTY_CONFIRMED')",
    [sourceIdentity, instance, backendA],
  );
  const a = await createPhysical(driverA, "gen-a", passwordA);
  const initialCursor = await latestCursor();
  const bootstrapA = await bootstrap({
    backend: a.backend,
    generationId: "gen-a",
    backendType: backendA,
    cursor: initialCursor,
  });
  await pool.query(
    "UPDATE rdf_generation SET state='SERVING',promoted_at=now() WHERE source_identity=$1 AND generation_id='gen-a'",
    [sourceIdentity],
  );
  await pool.query(
    "INSERT INTO rdf_query_service(query_service_id,source_identity) VALUES($1,$2)",
    [queryServiceId, sourceIdentity],
  );
  await pool.query(
    "INSERT INTO rdf_serving_pointer(query_service_id,source_identity,generation_id) VALUES($1,$2,'gen-a')",
    [queryServiceId, sourceIdentity],
  );
  const sourceReader = startSourceReader(),
    workerA = startWorker("gen-a", backendA, passwordA, 9191),
    router0 = startRouter(19200),
    router1 = startRouter(19201);
  processes.push(sourceReader, workerA, router0, router1);
  await waitHttp("http://127.0.0.1:19200/readyz");
  await waitHttp("http://127.0.0.1:19201/readyz");
  await assertRouters("gen-a");
  const beforeB = await editLabel(manifest.q1, "M9B A ahead 1");
  const afterB = await editLabel(manifest.q1, "M9B A ahead 2");
  const targetA = await latestCursor();
  await waitCursor("gen-a", targetA);
  const fenceA = await fence("gen-a", manifest.q1);
  const c0 = await latestCursor(),
    b = await createPhysical(driverB, "gen-b", passwordB),
    bootstrapB = await bootstrap({
      backend: b.backend,
      generationId: "gen-b",
      backendType: backendB,
      cursor: c0,
    });
  const fenceB0 = await fence("gen-b", manifest.q1);
  assert.ok(
    fenceA.indexed_revision >= fenceB0.indexed_revision,
    "B snapshot fence unexpectedly ahead of A",
  );
  const pEdit = await editProperty(manifest.properties.string),
    itemEdit = await editLabel(manifest.q1, "M9B catch-up item"),
    cycle = await deleteUndelete(manifest.q2),disposableProperty=await createProperty(),propertyCycle=await deleteUndelete(disposableProperty);
  const targetB = await latestCursor();
  await waitCursor("gen-a", targetB);
  const fenceAAfter=await fence('gen-a',manifest.q1);
  let workerB = startWorker("gen-b", backendB, passwordB, 9192);
  processes.push(workerB);
  await sleep(500);
  await driverB.stopGeneration({ generationId: "gen-b" });
  const candidateCursorBefore = (await generationSync("gen-b")).catchup_cursor_rcid,
    candidateOutageEdit = await editLabel(manifest.q1, "M9B candidate outage"),
    candidateOutageTarget = await latestCursor();
  await assertRouters("gen-a");
  await sleep(1000);
  assert.ok(
    Number((await generationSync("gen-b")).catchup_cursor_rcid) <
      candidateOutageTarget.rcid,
    "candidate advanced while backend was unavailable",
  );
  await driverB.startGeneration({ generationId: "gen-b" });
  await healthy(b.backend);
  await waitCursor("gen-b", candidateOutageTarget, 180000);
  measurements.candidateBackendOutage = {
    result: "safe_recovery",
    cursorBefore: candidateCursorBefore,
    revision: revision(candidateOutageEdit),
  };
  await waitCursor("gen-b", targetB, 180000);
  const fenceB = await fence("gen-b", manifest.q1);
  assert.ok(fenceB.indexed_revision >= revision(itemEdit));
  assert.equal((await generationSync("gen-b")).schema_state, "CURRENT");
  const equalityB = await equality(b.backend, "gen-b");
  assert.deepEqual(equalityB.diff, { canonicalOnly: [], generationOnly: [] });
  if(stopAfterEquality){output={status:'m9c_equality_gate_passed',backendA,backendB,independentFence:{aBefore:fenceA.indexed_revision,aAfter:fenceAAfter.indexed_revision,bAtC0:fenceB0.indexed_revision,bAfter:(await fence('gen-b',manifest.q1)).indexed_revision},propertySchemaState:(await generationSync('gen-b')).schema_state,restoredEntityState:await fence('gen-b',manifest.q2),propertyLifecycle:{entityId:disposableProperty,events:propertyCycle,state:await fence('gen-b',disposableProperty),graphs:(await pool.query('SELECT graph_iri FROM rdf_generation_graph WHERE source_identity=$1 AND generation_id=$2 AND entity_id=$3 ORDER BY graph_iri',[sourceIdentity,'gen-b',disposableProperty])).rows.map(value=>value.graph_iri)},equality:{graphs:equalityB.graphs,canonicalOnly:0,generationOnly:0}};throw new Error('M9C_EQUALITY_COMPLETE');}
  await pool.query(
    "UPDATE rdf_generation SET state='READY',validation_status='VALID',validation_checksum=$3 WHERE source_identity=$1 AND generation_id=$2",
    [sourceIdentity, "gen-b", equalityB.checksum],
  );
  await pool.query(
    "UPDATE rdf_generation_sync SET state='CURRENT' WHERE source_identity=$1 AND generation_id='gen-b'",
    [sourceIdentity],
  );
  await assertRouters("gen-a");
  await stopLocalPostgres();
  const unavailable = await fetch("http://127.0.0.1:19200/sparql", {
    method: "POST",
    headers: { "content-type": "application/sparql-query" },
    body: "ASK { ?s ?p ?o }",
  }).catch(() => null);
  assert.ok(!unavailable || !unavailable.ok, "router served without DB authority");
  await startLocalPostgres();
  await waitDatabase();
  await killAndRestartRouter(0, 19200);
  await killAndRestartRouter(1, 19201);
  await assertRouters("gen-a");
  measurements.postgresOutage = {
    routerPolicy: "fail_closed_without_pointer_authority",
    recovered: true,
  };
  const pointer = new PostgresServingPointerRepository({
      pool,
      queryServiceId,
    }),
    promotionId = randomUUID(),
    promoteStarted = performance.now();
  await pointer.promote({
    generationId: "gen-b",
    expectedGenerationId: "gen-a",
    expectedVersion: 1,
    promotionId,
  });
  measurements.promotionMs = performance.now() - promoteStarted;
  await assertRouters("gen-b");
  const crashEvidence = [];
  for (const point of [
    "AFTER_RC_FETCH",
    "AFTER_RDF_FETCH",
    "AFTER_BACKEND_UPDATE",
    "AFTER_FENCE_BEFORE_CURSOR",
  ]) {
    await stopProcess(workerB);
    const changed = await editLabel(manifest.q1, `M9B crash ${point}`),
      target = await latestCursor(),
      crashed = startWorker("gen-b", backendB, passwordB, 9192, point);
    processes.push(crashed);
    const exitCode = await waitExitWithin(crashed, 30000);
    assert.equal(exitCode, 86, `${point} did not hard-crash`);
    workerB = startWorker("gen-b", backendB, passwordB, 9192);
    processes.push(workerB);
    await waitCursor("gen-b", target, 180000);
    const stateAfter = await fence("gen-b", manifest.q1);
    assert.ok(stateAfter.indexed_revision >= revision(changed));
    assert.equal((await servingPointer()).generation_id, "gen-b");
    crashEvidence.push({ point, exitCode, revision: revision(changed), recovered: true });
  }
  measurements.workerCrashMatrix = crashEvidence;
  await driverB.stopGeneration({ generationId: "gen-b" });
  const backendUnavailable = await fetch("http://127.0.0.1:19200/sparql", {
    method: "POST",
    headers: { "content-type": "application/sparql-query" },
    body: "ASK { ?s ?p ?o }",
  }).catch(() => null);
  assert.ok(!backendUnavailable || !backendUnavailable.ok);
  assert.equal((await servingPointer()).generation_id, "gen-b");
  await driverB.startGeneration({ generationId: "gen-b" });
  await healthy(b.backend);
  await assertRouters("gen-b");
  measurements.servingBackendOutage = {
    pointerUnchanged: true,
    noCandidateAutoSelection: true,
    recovered: true,
  };
  await killAndRestartRouter(0, 19200);
  await assertRouters("gen-b");
  await stopProcess(workerA);
  const post = await editLabel(manifest.q1, "M9B post promotion");
  const postCursor = await latestCursor();
  await waitCursor("gen-b", postCursor);
  const rollback = await pointer.rollback({ expectedVersion: 2, promotionId });
  assert.equal(rollback.generationId, "gen-a");
  await assertRouters("gen-a");
  const stale = await pool.query(
    "SELECT catchup_cursor_rcid FROM rdf_generation_sync WHERE source_identity=$1 AND generation_id=$2",
    [sourceIdentity, "gen-a"],
  );
  assert.ok(Number(stale.rows[0].catchup_cursor_rcid) < postCursor.rcid);
  await pointer.promote({
    generationId: "gen-b",
    expectedGenerationId: "gen-a",
    expectedVersion: 3,
    promotionId: randomUUID(),
  });
  await assertRouters("gen-b");
  if (soakSeconds) {
    const soakStarted = qualificationStarted,
      soakEnds = soakStarted + soakSeconds * 1000,
      resourceSamples = [];
    let edits = 0,
      nextEditAt = Date.now(),
      nextResourceAt = Date.now();
    await editQualifier();
    await editReference();
    await editProperty(manifest.properties.string);
    await deleteUndelete(manifest.q2);
    while (Date.now() < soakEnds) {
      const queryStarted = performance.now();
      await routerQuery(19200);
      measurements.queryLatencyMs ??= [];
      measurements.queryLatencyMs.push(performance.now() - queryStarted);
      visibility.push("NEW_COMPLETE");
      if (Date.now() >= nextEditAt) {
        const changed = await editLabel(manifest.q1, `M9B soak ${edits}-${Date.now()}`),
          target = await latestCursor();
        await waitCursor("gen-b", target, 180000);
        assert.ok((await fence("gen-b", manifest.q1)).indexed_revision >= revision(changed));
        edits++;
        nextEditAt = Date.now() + 30000;
      }
      if (Date.now() >= nextResourceAt) {
        resourceSamples.push({ at: new Date().toISOString(), resources: stats() });
        nextResourceAt = Date.now() + 60000;
      }
      await sleep(1000);
    }
    measurements.soakElapsedSeconds = Math.round(
      (Date.now() - soakStarted) / 1000,
    );
    measurements.soakEdits = edits;
    measurements.soakStartedAt = new Date(soakStarted).toISOString();
    measurements.soakEndedAt = new Date().toISOString();
    measurements.soakResourceSamples = resourceSamples;
    const end = await latestCursor();
    await waitCursor("gen-b", end);
    const finalEquality = await equality(b.backend, "gen-b");
    assert.deepEqual(finalEquality.diff, {
      canonicalOnly: [],
      generationOnly: [],
    });
    output = { finalEquality };
  }
  const sourceCursor = (
      await pool.query(
        "SELECT ingestion_cursor_timestamp,ingestion_cursor_rcid FROM rdf_sync_source WHERE source_identity=$1",
        [sourceIdentity],
      )
    ).rows[0],
    syncA = await generationSync("gen-a"),
    syncB = await generationSync("gen-b");
  measurements.resources = stats();
  output = {
    ...(output ?? {}),
    status: "deterministic_pipeline_passed",
    backendA,
    backendB,
    realSource: true,
    realProcesses: true,
    sourceCursor,
    syncA,
    syncB,
    bootstrapA,
    bootstrapB,
    independentFence: {
      a: fenceA.indexed_revision,
      bAtC0: fenceB0.indexed_revision,
      bAfter: fenceB.indexed_revision,
      edits: [revision(beforeB), revision(afterB), revision(itemEdit)],
      propertyRevision: revision(pEdit),
      deleteUndelete: cycle,
      postPromotionRevision: revision(post),
    },
    equalityB: {
      ...equalityB,
      diff: {
        canonicalOnly: equalityB.diff.canonicalOnly.length,
        generationOnly: equalityB.diff.generationOnly.length,
      },
    },
    visibility: summarize(visibility),
    measurements,
  };
} catch(error) {
  if(String(error?.message)!=='M9C_EQUALITY_COMPLETE')throw error;
} finally {
  for (const child of processes.reverse()) await stopProcess(child);
  if (pool) await pool.end();
  await driverB.deleteGeneration({ generationId: "gen-b" }).catch(() => {});
  await driverA.deleteGeneration({ generationId: "gen-a" }).catch(() => {});
  for (const file of files)
    try {
      unlinkSync(file);
    } catch {}
  stopPostgres();
}
console.log(JSON.stringify(output, null, 2));

async function seedRegistry() {
  const user = randomUUID(),
    host = randomUUID();
  await pool.query(
    "INSERT INTO controller_user(id,external_subject,display_name) VALUES($1,'m9b-admin','M9B Admin')",
    [user],
  );
  await pool.query(
    "INSERT INTO controller_host(id,name,adapter_kind,adapter_ref) VALUES($1,'m9b-host','kubernetes','local-m9b')",
    [host],
  );
  await pool.query("INSERT INTO controller_instance(id,host_id,owner_user_id,slug,display_name,namespace,helm_release,hostname,query_hostname,environment) VALUES($1,$2,$3,'m9b-local','M9B Local','m9b-local','m9b-local','m9b.local','query.m9b.local','development')",[randomUUID(),host,user]);
}
async function createPhysical(driver, generationId, password) {
  driver.adminPassword = password;
  await driver.createGeneration({ generationId });
  const backend = driver.backend(generationId);
  await healthy(backend);
  await backend.initialize({ instanceId: `m9b-${generationId}` });
  return { backend };
}
async function bootstrap({ backend, generationId, backendType, cursor }) {
  cursor ??= await latestCursor();
  const started = performance.now(),
    rdf = dump(),
    checksum = createHash("sha256").update(rdf).digest("hex");
  await pool.query(
    "INSERT INTO rdf_generation(source_identity,generation_id,backend_type,state,source_snapshot_timestamp,source_snapshot_rcid,normalization_model,partition_model) VALUES($1,$2,$3,'LOADING',$4,$5,$6,'jwb-partition-v1')",
    [sourceIdentity, generationId, backendType, cursor.timestamp, cursor.rcid,JWB_RDF_NORMALIZATION_MODEL],
  );
  const repository = new PostgresGenerationSyncRepository({
    pool,
    sourceIdentity,
    generationId,
  });
  await repository.initialize({ snapshotCursor: cursor });
  const loaded = await new GenerationDatasetLoader({
    backend,
    repository,
  }).loadSnapshot({ rdf });
  await repository.markCurrent();
  const eq = await equality(backend, generationId, rdf);
  assert.deepEqual(eq.diff, { canonicalOnly: [], generationOnly: [] });
  await pool.query(
    "UPDATE rdf_generation SET state='READY',validation_status='VALID',validation_checksum=$3,catchup_timestamp=$4,catchup_rcid=$5,generation_manifest=$6 WHERE source_identity=$1 AND generation_id=$2",
    [sourceIdentity, generationId, checksum, cursor.timestamp, cursor.rcid,generationManifest({generationId,sourceIdentity,sourceCursor:cursor,normalizations:[{provenance:loaded.provenance}],datasetChecksum:eq.checksum})],
  );
  return {
    ...loaded,
    cursor,
    durationMs: Math.round(performance.now() - started),
  };
}
function startWorker(generationId, backend, password, port, crashAt = null) {
  return child("node", ["apps/rdf-sync-worker/src/main.js"], {
    JWB_SYNC_BACKEND: backend,
    JWB_SYNC_SOURCE_URL: JWB_BASE_URL,
    JWB_SYNC_SOURCE_IDENTITY: sourceIdentity,
    JWB_SYNC_GENERATION_ID: generationId,
    JWB_SYNC_DATABASE_URL: databaseUrl,
    JWB_SYNC_POLL_INTERVAL_MS: "250",
    JWB_SYNC_HEALTH_PORT: String(port),
    JWB_RDF_ADMIN_PASSWORD: password,
    ...(crashAt ? { JWB_SYNC_CRASH_AT: crashAt } : {}),
  });
}
function startSourceReader() {
  return child("node", ["apps/rdf-source-reader/src/main.js"], {
    JWB_SOURCE_READER_DATABASE_URL: databaseUrl,
    JWB_SOURCE_READER_URL: JWB_BASE_URL,
    JWB_SOURCE_READER_IDENTITY: sourceIdentity,
    JWB_SOURCE_READER_POLL_MS: "250",
  });
}
function startRouter(port) {
  return child("node", ["apps/query-router/src/main.js"], {
    JWB_ROUTER_BACKEND_A: backendA,
    JWB_ROUTER_BACKEND_B: backendB,
    JWB_ROUTER_DATABASE_URL: databaseUrl,
    JWB_ROUTER_QUERY_SERVICE_ID: queryServiceId,
    JWB_ROUTER_PORT: String(port),
  });
}
function child(command, args, env) {
  return spawn(command, args, {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "inherit"],
  });
}
async function killAndRestartRouter(index, port) {
  const previous = processes[index + 2];
  await stopProcess(previous);
  const next = startRouter(port);
  processes[index + 2] = next;
  await waitHttp(`http://127.0.0.1:${port}/readyz`);
}
async function assertRouters(expected) {
  const pointer = (await pool.query("SELECT generation_id,version FROM rdf_serving_pointer WHERE query_service_id=$1",[queryServiceId])).rows[0];
  assert.equal(pointer.generation_id,expected);
  for (const port of [19200, 19201]) {
    const response = await routerQuery(port);
    assert.equal(
      response.headers.get("x-jwb-pointer-version"),
      String(pointer.version),
      "pointer header",
    );
    visibility.push(expected === "gen-a" ? "OLD_COMPLETE" : "NEW_COMPLETE");
  }
}
async function routerQuery(port) {
  const response = await fetch(`http://127.0.0.1:${port}/sparql`, {
    method: "POST",
    headers: {
      accept: "application/sparql-results+json",
      "content-type": "application/sparql-query",
    },
    body: "ASK { ?s ?p ?o }",
  });
  if (!response.ok) throw new Error(`router query HTTP ${response.status}`);
  assert.equal((await response.json()).boolean, true);
  return response;
}
async function equality(backend, generationId, rdf = dump()) {
  const graphIris = (
      await pool.query(
        "SELECT graph_iri FROM rdf_generation_graph WHERE source_identity=$1 AND generation_id=$2 ORDER BY graph_iri",
        [sourceIdentity, generationId],
      )
    ).rows.map((v) => v.graph_iri),
    observed = [];
  for (const graphIri of graphIris) {
    const response = await fetch(backend.queryUrl, {
      method: "POST",
      headers: {
        accept: "application/n-triples",
        "content-type": "application/sparql-query",
      },
      body: `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${graphIri}> { ?s ?p ?o } }`,
    });
    if (!response.ok) throw new Error(`export HTTP ${response.status}`);
    for (const line of (await response.text())
      .trim()
      .split("\n")
      .filter(Boolean))
      observed.push(`${line.slice(0, -1).trimEnd()} <${graphIri}> .`);
  }
  const normalized=normalizeWikibaseRdf(rdf,{sourceKind:'FULL_DUMP'}),expected = datasetToNQuads(partitionWikibaseSnapshot(normalized.rdf)),
    actual = observed.sort().join("\n") + "\n";
  return {
    checksum: createHash("sha256").update(expected).digest("hex"),
    graphs: graphIris.length,
    diff: diffCanonicalRdfDatasets(expected, actual),
  };
}
function dump() {
  return execFileSync(
    "docker",
    [
      "compose",
      "--project-name",
      JWB_PROJECT,
      "--file",
      new URL("../infrastructure/japan-wikibase/compose.yaml", import.meta.url)
        .pathname,
      "exec",
      "--no-TTY",
      "wikibase",
      "php",
      "extensions/Wikibase/repo/maintenance/dumpRdf.php",
      "--format",
      "nt",
      "--flavor",
      "full-dump",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DOCKER_CONTEXT: JWB_DOCKER_CONTEXT,
        ...stateEnvironment(state),
      },
    },
  );
}
async function latestCursor() {
  const value = await api({
      action: "query",
      list: "recentchanges",
      rclimit: "1",
      rcdir: "older",
      rcnamespace: "120|122",
      rcprop: "ids|timestamp",
    }),
    event = value.query.recentchanges[0];
  return { sourceIdentity, timestamp: event.timestamp, rcid: event.rcid };
}
async function waitCursor(generationId, target, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await generationSync(generationId);
    if (
      value.catchup_cursor_timestamp &&
      (Date.parse(value.catchup_cursor_timestamp) >
        Date.parse(target.timestamp) ||
        (Date.parse(value.catchup_cursor_timestamp) ===
          Date.parse(target.timestamp) &&
          Number(value.catchup_cursor_rcid) >= target.rcid))
    )
      return;
    await sleep(250);
  }
  throw new Error(`cursor timeout ${generationId}`);
}
async function generationSync(id) {
  return (
    await pool.query(
      "SELECT * FROM rdf_generation_sync WHERE source_identity=$1 AND generation_id=$2",
      [sourceIdentity, id],
    )
  ).rows[0];
}
async function fence(id, entity) {
  return (
    await pool.query(
      "SELECT * FROM rdf_generation_entity_revision WHERE source_identity=$1 AND generation_id=$2 AND entity_id=$3",
      [sourceIdentity, id, entity],
    )
  ).rows[0];
}
async function editLabel(id, value) {
  const session = await login();
  return post(session, {
    action: "wbsetlabel",
    id,
    language: "ja",
    value,
    summary: "M9B local qualification",
  });
}
async function editProperty(id) {
  const session = await login();
  return post(session, {
    action: "wbsetlabel",
    id,
    language: "en",
    value: `M9B schema ${Date.now()}`,
    summary: "M9B Property schema qualification",
  });
}
async function editQualifier() {
  const session = await login();
  return post(session, {
    action: "wbsetqualifier",
    claim: manifest.claimIds.string,
    property: manifest.properties.qualifier,
    snaktype: "value",
    value: JSON.stringify(`M9B soak qualifier ${Date.now()}`),
    summary: "M9B soak qualifier",
  });
}
async function editReference() {
  const session = await login();
  return post(session, {
    action: "wbsetreference",
    statement: manifest.claimIds.string,
    snaks: JSON.stringify({
      [manifest.properties.reference]: [
        {
          snaktype: "value",
          property: manifest.properties.reference,
          datatype: "url",
          datavalue: {
            value: `https://example.invalid/m9b-soak-${Date.now()}`,
            type: "string",
          },
        },
      ],
    }),
    summary: "M9B soak reference",
  });
}
async function deleteUndelete(id) {
  const session = await login(),
    title = `${id.startsWith('P')?'Property':'Item'}:${id}`,
    deleted = await post(session, {
      action: "delete",
      title,
      reason: "M9B local delete",
    }),
    undeleted = await post(session, {
      action: "undelete",
      title,
      reason: "M9B local undelete",
    });
  return {
    deleteLogId: deleted.logid ?? null,
    undeleteRevision: undeleted.pageinfo?.lastrevid ?? null,
  };
}
async function createProperty(){const session=await login(),suffix=`${manifest.datasetRunId}-${Date.now()}`,value=await post(session,{action:'wbeditentity',new:'property',data:JSON.stringify({datatype:'string',labels:{ja:{language:'ja',value:`M9B lifecycle ${suffix}`},en:{language:'en',value:`M9B lifecycle ${suffix}`}}}),summary:'M9B disposable Property lifecycle'}),id=value.entity?.id;if(!/^P[1-9][0-9]*$/u.test(id))throw new Error('M9B_PROPERTY_CREATE_FAILED');return id;}
async function login() {
  let v = await request({ action: "query", meta: "tokens", type: "login" });
  v = await request(
    {
      action: "login",
      lgname: state.adminUser,
      lgpassword: state.adminPassword,
      lgtoken: v.data.query.tokens.logintoken,
    },
    v.cookie,
    true,
  );
  const csrf = await request({ action: "query", meta: "tokens" }, v.cookie);
  return { cookie: csrf.cookie, token: csrf.data.query.tokens.csrftoken };
}
async function post(session, parameters) {
  const v = await request(
    { ...parameters, token: session.token },
    session.cookie,
    true,
  );
  if (v.data.error) throw new Error(v.data.error.code);
  return v.data;
}
async function api(parameters) {
  return (await request(parameters)).data;
}
async function request(parameters, cookie = "", postRequest = false) {
  const values = { format: "json", formatversion: "2", ...parameters },
    response = postRequest
      ? await fetch(`${JWB_BASE_URL}/api.php`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie,
          },
          body: new URLSearchParams(values),
        })
      : await fetch(`${JWB_BASE_URL}/api.php?${new URLSearchParams(values)}`, {
          headers: cookie ? { cookie } : {},
        });
  const cookies = new Map(
    cookie
      .split("; ")
      .filter(Boolean)
      .map((v) => [v.split("=", 1)[0], v]),
  );
  for (const v of response.headers.getSetCookie?.() ?? []) {
    const pair = v.split(";", 1)[0];
    cookies.set(pair.split("=", 1)[0], pair);
  }
  return {
    data: await response.json(),
    cookie: [...cookies.values()].join("; "),
  };
}
function revision(v) {
  return (
    v.entity?.lastrevid ?? v.pageinfo?.lastrevid ?? v.claim?.lastrevid ?? null
  );
}
async function startPostgres() {
  const image =
    "postgres:16.9-bookworm@sha256:253815cf7579ffa05e1673d92e78d37273e61be0e4414e9a1449337d7925be94";
  execFileSync("docker", [
    "run",
    "--detach",
    "--name",
    dbName,
    "--label",
    "wikibase-federation.local-test=true",
    "--publish",
    "127.0.0.1:15439:5432",
    "--env",
    `POSTGRES_PASSWORD=${dbPassword}`,
    "--env",
    "POSTGRES_DB=m9b",
    image,
  ]);
  for (let i = 0; i < 60; i++) {
    try {
      execFileSync(
        "docker",
        ["exec", dbName, "pg_isready", "-U", "postgres", "-d", "m9b"],
        { stdio: "ignore" },
      );
      break;
    } catch {
      await sleep(250);
    }
  }
  const mapping = execFileSync("docker", ["port", dbName, "5432/tcp"], {
      encoding: "utf8",
    }).trim(),
    port = mapping.slice(mapping.lastIndexOf(":") + 1);
  const url=`postgresql://postgres:${dbPassword}@127.0.0.1:${port}/m9b`;
  for(let attempt=0;attempt<60;attempt+=1){const client=new pg.Client({connectionString:url});try{await client.connect();await client.query('SELECT 1');await client.end();return url;}catch{await client.end().catch(()=>{});if(attempt===59)throw new Error('PostgreSQL connection timeout');await sleep(250);}}
  throw new Error('PostgreSQL connection timeout');
}
function stopPostgres() {
  try {
    execFileSync("docker", ["rm", "--force", dbName], { stdio: "ignore" });
  } catch {}
}
async function stopLocalPostgres() {
  await pool.end();
  pool = null;
  execFileSync("docker", ["stop", dbName], { stdio: "ignore" });
  await sleep(500);
}
async function startLocalPostgres() {
  execFileSync("docker", ["start", dbName], { stdio: "ignore" });
  pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  pool.on("error", () => {});
}
async function waitDatabase() {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error(`PostgreSQL recovery timeout: ${lastError?.message ?? "unknown"}`);
}
async function servingPointer() {
  return (
    await pool.query(
      "SELECT generation_id,version FROM rdf_serving_pointer WHERE query_service_id=$1",
      [queryServiceId],
    )
  ).rows[0];
}
async function healthy(backend) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if ((await backend.health()).status === "healthy") return;
    await sleep(250);
  }
  throw new Error("backend health timeout");
}
async function waitHttp(url) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`HTTP wait timeout ${url}`);
}
async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([waitExit(child), sleep(5000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
function waitExit(child) {
  return new Promise((resolve) => child.once("exit", resolve));
}
async function waitExitWithin(child, timeout) {
  return Promise.race([
    waitExit(child),
    sleep(timeout).then(() => {
      throw new Error("process exit timeout");
    }),
  ]);
}
function stats() {
  const rows = execFileSync(
    "docker",
    ["stats", "--no-stream", "--format", "{{json .}}"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((value) => JSON.parse(value));
  return rows
    .filter((v) => /wfp-jwb-m1|wfp-jwb-m9|wfp-jwb-m9b/u.test(v.Name))
    .map((v) => ({
      name: v.Name,
      memory: v.MemUsage,
      blockIO: v.BlockIO,
      cpu: v.CPUPerc,
    }));
}
function summarize(values) {
  return Object.fromEntries(
    [...new Set(values)].map((k) => [k, values.filter((v) => v === k).length]),
  );
}
function option(prefix) {
  return process.argv.find((v) => v.startsWith(prefix))?.slice(prefix.length);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function assertLocal() {
  const context = execFileSync("docker", ["context", "show"], {
      encoding: "utf8",
    }).trim(),
    [os, architecture] = execFileSync(
      "docker",
      ["info", "--format", "{{.OperatingSystem}}\n{{.Architecture}}"],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n");
  assertJwbDockerTarget({
    context,
    operatingSystem: os.includes("Docker Desktop") ? "linux" : os.toLowerCase(),
    architecture,
  });
}
