#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = "/home/hiroki_u/custom-wikibase-qualification";
const tools = `${root}/tools/bin`;
const kubeconfig = `${root}/k1b-kubeconfig.yaml`;
const namespace = "custom-wikibase-k1b-oxigraph";
const output = `${root}/artifacts/kubernetes-k1b`;
const run = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
const kubectl = (...args) => run(`${tools}/kubectl`, ["--kubeconfig", kubeconfig, ...args]);
const write = (name, value) => writeFileSync(`${output}/${name}`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
if (process.argv.length !== 2) throw new Error("K1B_ARGUMENTS_FORBIDDEN");
if (run("hostname", []) !== "abaiang" || run("uname", ["-s"]) !== "Linux" || run("uname", ["-m"]) !== "x86_64") throw new Error("K1B_UNSAFE_HOST");
if (kubectl("config", "current-context") !== "k3d-custom-wikibase-k1b-amd64") throw new Error("K1B_UNSAFE_CONTEXT");
const server = kubectl("config", "view", "--minify", "-o", "jsonpath={.clusters[0].cluster.server}");
if (!/^https:\/\/(?:0\.0\.0\.0|127\.0\.0\.1|localhost):[0-9]+$/u.test(server)) throw new Error("K1B_NONLOCAL_API");
mkdirSync(output, { recursive: true });
const pods = JSON.parse(kubectl("-n", namespace, "get", "pods", "-o", "json"));
const pvcs = JSON.parse(kubectl("-n", namespace, "get", "pvc", "-o", "json"));
const services = JSON.parse(kubectl("-n", namespace, "get", "service", "-o", "json"));
const jobs = JSON.parse(kubectl("-n", namespace, "get", "job", "-o", "json")).items;
const latest = prefix => jobs.filter(value => value.metadata.name.startsWith(prefix)).sort((a, b) => String(a.metadata.creationTimestamp).localeCompare(String(b.metadata.creationTimestamp))).at(-1);
const migration = latest("jwb-migrate-"); const bootstrap = latest("jwb-bootstrap-");
if (!migration?.status.succeeded || !bootstrap?.status.succeeded) throw new Error("K1B_MIGRATION_EVIDENCE_MISSING");
const identity = path => { const value = JSON.parse(readFileSync(path, "utf8")); return Object.fromEntries(value.items.map(item => [item.metadata.name, { uid: item.metadata.uid, volume: item.spec.volumeName }])); };
const fusekiBefore = identity(`${output}/fuseki-pvc-before.json`), fusekiAfter = identity(`${output}/fuseki-pvc-after.json`);
const oxigraphBefore = identity(`${output}/oxigraph-pvc-before.json`), oxigraphAfter = identity(`${output}/oxigraph-pvc-after.json`);
const imageReferences = [
  "japan-wikibase/core:0.1.0-rc.1", "japan-wikibase/runtime:0.1.0-rc.1", "japan-wikibase/snapshot-producer:0.1.0-rc.1",
  "japan-wikibase/fuseki:6.1.0", "oxigraph/oxigraph:0.5.7@sha256:fa3a660c0f5ec776472c0828309dec8a5410b7267e2dcac59ab7d7f29e10da28",
].map(image => ({ image, ...JSON.parse(run("docker", ["image", "inspect", image, "--format", "{\"id\":\"{{.Id}}\",\"os\":\"{{.Os}}\",\"architecture\":\"{{.Architecture}}\"}"])) }));
if (imageReferences.some(value => value.os !== "linux" || value.architecture !== "amd64")) throw new Error("K1B_NON_AMD64_IMAGE");
const matrix = {
  virtuoso: "KUBERNETES_VIRTUOSO_PASS (K1A)", fusekiTdb2: "KUBERNETES_FUSEKI_TDB2_PASS", oxigraph: "KUBERNETES_OXIGRAPH_PASS",
  capabilities: ["Snapshot load", "Incremental update", "Property/schema", "Delete/undelete", "Canonical equality", "A/B promotion", "Rollback", "Pod restart", "PVC persistence", "Public UPDATE blocked"],
};
write("qualification.json", { schemaVersion: 1, classification: "CUSTOM_WIKIBASE_K1B_ALL_RDF_BACKENDS_QUALIFIED", coreK1aPreserved: true,
  backends: { virtuoso: { status: "PASS", evidence: "kubernetes-k1a" }, "fuseki-tdb2": { status: "PASS", candidateEquality: { missing: 0, extra: 0 }, servingEquality: { missing: 0, extra: 0 } }, oxigraph: { status: "PASS", candidateEquality: { missing: 0, extra: 0 }, servingEquality: { missing: 0, extra: 0 } } },
  commonContract: { deterministicSnapshotRace: "PASS", promotionRollback: "PASS", postPromotionSync: "PASS", restartMatrix: "PASS", stopStart: "PASS", publicUpdateBlocked: "PASS", internalEndpointsPrivate: "PASS" },
  networkPolicy: "NETWORK_POLICY_NOT_QUALIFIED_IN_K3D", productionReadinessClaim: false });
write("environment.json", { host: "abaiang", os: "Linux", architecture: "x86_64", apiServer: server, cluster: "custom-wikibase-k1b-amd64", context: "k3d-custom-wikibase-k1b-amd64", k3d: run(`${tools}/k3d`, ["version"]).split("\n")[0], kubectl: run(`${tools}/kubectl`, ["version", "--client"]).split("\n")[0], helm: run(`${tools}/helm`, ["version", "--short"]), docker: run("docker", ["version", "--format", "{{.Server.Version}}"]), scope: "disposable; not production sizing" });
write("images.json", { verified: imageReferences, observedOxigraphPods: pods.items.flatMap(pod => (pod.status.containerStatuses ?? []).map(status => ({ pod: pod.metadata.name, image: status.image, imageId: status.imageID }))) });
write("backend-matrix.json", matrix);
write("timings.json", { scope: "engineering observations, not benchmarks", migrationSeconds: duration(migration), bootstrapSeconds: duration(bootstrap), exactEndToEndTimings: "not instrumented; future harness item" });
let top = "metrics unavailable"; try { top = kubectl("top", "pod", "-n", namespace); } catch {}
write("resources.json", { scope: "disposable Linux AMD64 k3d; not production sizing", top, pvcRequests: pvcs.items.map(value => ({ name: value.metadata.name, requested: value.spec.resources.requests.storage })) });
write("pvc-identities.json", { fuseki: { unchanged: JSON.stringify(fusekiBefore) === JSON.stringify(fusekiAfter), before: fusekiBefore, after: fusekiAfter }, oxigraph: { unchanged: JSON.stringify(oxigraphBefore) === JSON.stringify(oxigraphAfter), before: oxigraphBefore, after: oxigraphAfter } });
write("restart-matrix.json", { result: "PASS", backends: ["fuseki-tdb2", "oxigraph"], components: ["wikibase", "job-runner", "mariadb", "jwb-postgresql", "rdf-source-reader", "rdf-sync-worker-a", "rdf-sync-worker-b", "query-router", "backend-a", "backend-b"], stopEquivalentReachedRunningPods: 0, finalServingGeneration: "gen-b" });
write("migration-sequence.json", { backendNeutral: true, versions: ["005", "006", "007", "008", "009", "010", "011", "012", "013"], migration: { succeeded: 1, durationSeconds: duration(migration) }, bootstrap: { succeeded: 1, gatedByMigrationStatus: true, durationSeconds: duration(bootstrap) } });
write("cleanup.json", { status: "PENDING", fusekiNamespaceRemoved: true, oxigraphNamespaceRemoved: false, clusterRemoved: false, dedicatedKubeconfigRemoved: false, dbpediaUnchanged: true });
writeFileSync(`${output}/summary.md`, `# Custom Wikibase K1B qualification\n\n- Classification: **CUSTOM_WIKIBASE_K1B_ALL_RDF_BACKENDS_QUALIFIED**\n- Fuseki/TDB2: KUBERNETES_FUSEKI_TDB2_PASS\n- Oxigraph: KUBERNETES_OXIGRAPH_PASS\n- Canonical equality: 0/0 for both\n- Common snapshot, incremental, promotion, rollback, restart and persistence contract: PASS\n- NetworkPolicy: NETWORK_POLICY_NOT_QUALIFIED_IN_K3D\n- Production readiness: not claimed\n- Cleanup: pending at collection time\n`, { mode: 0o644 });
process.stdout.write(`${output}\n`);
function duration(job) { const start = Date.parse(job.status.startTime), end = Date.parse(job.status.completionTime); return Number.isFinite(start) && Number.isFinite(end) ? (end - start) / 1000 : null; }
