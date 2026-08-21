#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";

if (process.argv.length !== 3 || process.argv[2] !== "/artifacts") throw new Error("K2_FIXED_ARTIFACT_PATH_REQUIRED");
const output = process.argv[2];
const instances = {
  "cw-a": { port: 8281, queryPort: 8291, id: "11111111-1111-4111-8111-111111111111", backend: "virtuoso", label: "K2 Virtuoso isolated item" },
  "cw-b": { port: 8282, queryPort: 8292, id: "22222222-2222-4222-8222-222222222222", backend: "oxigraph", label: "K2 Oxigraph isolated item" },
  "cw-c": { port: 8283, queryPort: null, id: "33333333-3333-4333-8333-333333333333", backend: null, label: "K2 Core-only isolated item" },
};
mkdirSync(output, { recursive: true });
const evidence = { schemaVersion: 1, instances: {}, apiIsolation: {}, sparqlIsolation: {} };
for (const [name, config] of Object.entries(instances)) {
  const runtime = await json(`http://127.0.0.1:${config.port}/.well-known/japan-wikibase-runtime`);
  if (runtime.instance?.id !== config.id) throw new Error(`K2_UUID_MISMATCH_${name}`);
  if (config.backend ? runtime.queryService?.backendType !== config.backend : runtime.queryService?.enabled !== false) throw new Error(`K2_PROFILE_MISMATCH_${name}`);
  evidence.instances[name] = { instanceId: runtime.instance.id, queryService: runtime.queryService };
  evidence.apiIsolation[name] = {};
  const pages = await json(`http://127.0.0.1:${config.port}/api.php?${new URLSearchParams({ action: "query", list: "allpages", apnamespace: "120", aplimit: "max", format: "json", formatversion: "2" })}`);
  const ids = (pages.query?.allpages ?? []).map(value => String(value.title).replace(/^Item:/u, "")).filter(value => /^Q[1-9][0-9]*$/u.test(value));
  const entities = ids.length ? await json(`http://127.0.0.1:${config.port}/api.php?${new URLSearchParams({ action: "wbgetentities", ids: ids.join("|"), props: "labels", languages: "en", format: "json", formatversion: "2" })}`) : { entities: {} };
  const labels = Object.values(entities.entities ?? {}).map(value => value.labels?.en?.value).filter(Boolean);
  for (const [other, target] of Object.entries(instances)) {
    const found = labels.includes(target.label);
    if (found !== (name === other)) throw new Error(`K2_API_ISOLATION_${name}_${other}`);
    evidence.apiIsolation[name][other] = found;
  }
}
for (let attempt = 0; attempt < 90; attempt++) {
  const states = await Promise.all(["cw-a", "cw-b"].map(async name => (await json(`http://127.0.0.1:${instances[name].port}/.well-known/japan-wikibase-runtime`)).queryService?.syncState));
  if (states.every(value => value === "CURRENT")) break;
  if (attempt === 89) throw new Error("K2_SYNC_NOT_CURRENT");
  await new Promise(resolve => setTimeout(resolve, 2000));
}
for (const name of ["cw-a", "cw-b"]) {
  evidence.sparqlIsolation[name] = {};
  const query = "SELECT ?label WHERE { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?label }";
  const result = await json(`http://127.0.0.1:${instances[name].queryPort}/sparql`, { method: "POST", headers: { accept: "application/sparql-results+json", "content-type": "application/sparql-query" }, body: query });
  const labels = (result.results?.bindings ?? []).map(value => value.label?.value).filter(Boolean);
  for (const other of ["cw-a", "cw-b"]) {
    const found = labels.includes(instances[other].label);
    if (found !== (name === other)) throw new Error(`K2_SPARQL_ISOLATION_${name}_${other}`);
    evidence.sparqlIsolation[name][other] = found;
  }
}
writeFileSync(`${output}/isolation.json`, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
process.stdout.write("K2_IDENTITY_API_SPARQL_ISOLATION_PASS\n");

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`K2_HTTP_${response.status}_${await response.text()}`);
  return response.json();
}
