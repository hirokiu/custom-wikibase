#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateSemanticFixtureManifest } from "../packages/rdf-sync/src/semantic-fixture-manifest.js";

if (process.argv.length !== 2) throw new Error("K1B_CONTROLLED_EDIT_ARGUMENTS_FORBIDDEN");
const runtime = JSON.parse(readFileSync("/tmp/japan-wikibase-runtime.json", "utf8"));
const fixture = validateSemanticFixtureManifest(JSON.parse(readFileSync("/tmp/japan-wikibase-semantic-fixture.json", "utf8")));
if (runtime.project !== "japan-wikibase" || runtime.adminUser !== "JwbAdmin") throw new Error("K1B_CONTROLLED_EDIT_RUNTIME_INVALID");
const session = await login();
const value = `k1b-snapshot-race-${Date.now()}`;
const result = await api({ action: "wbeditentity", id: fixture.subjectItem, token: session.token,
  data: JSON.stringify({ aliases: { en: [{ language: "en", value }] } }), summary: "K1B deterministic snapshot race" }, session.cookie, true);
if (!result.data.entity?.lastrevid) throw new Error("K1B_CONTROLLED_EDIT_FAILED");
process.stdout.write(`${JSON.stringify({ entityId: fixture.subjectItem, revision: Number(result.data.entity.lastrevid), value })}\n`);

async function login() {
  let result = await api({ action: "query", meta: "tokens", type: "login" });
  result = await api({ action: "login", lgname: runtime.adminUser, lgpassword: runtime.adminPassword,
    lgtoken: result.data.query.tokens.logintoken }, result.cookie, true);
  if (result.data.login?.result !== "Success") throw new Error("K1B_CONTROLLED_EDIT_LOGIN_FAILED");
  const csrf = await api({ action: "query", meta: "tokens" }, result.cookie);
  return { cookie: csrf.cookie, token: csrf.data.query.tokens.csrftoken };
}
async function api(parameters, cookie = "", post = false) {
  const values = { format: "json", formatversion: "2", ...parameters };
  const response = post
    ? await fetch("http://127.0.0.1:8280/api.php", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams(values) })
    : await fetch(`http://127.0.0.1:8280/api.php?${new URLSearchParams(values)}`, { headers: cookie ? { cookie } : {} });
  if (!response.ok) throw new Error(`K1B_CONTROLLED_EDIT_HTTP_${response.status}`);
  const cookies = new Map(cookie.split("; ").filter(Boolean).map(value => [value.split("=", 1)[0], value]));
  for (const value of response.headers.getSetCookie?.() ?? []) { const pair = value.split(";", 1)[0]; cookies.set(pair.split("=", 1)[0], pair); }
  return { data: await response.json(), cookie: [...cookies.values()].join("; ") };
}
