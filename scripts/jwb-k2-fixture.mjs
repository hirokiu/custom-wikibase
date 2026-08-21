#!/usr/bin/env node
import { readFileSync } from "node:fs";

const instances = Object.freeze({
  "cw-a": { base: "http://127.0.0.1:8281", label: "K2 Virtuoso isolated item" },
  "cw-b": { base: "http://127.0.0.1:8282", label: "K2 Oxigraph isolated item" },
  "cw-c": { base: "http://127.0.0.1:8283", label: "K2 Core-only isolated item" },
});
const instance = process.argv[2];
if (process.argv.length !== 3 || !Object.hasOwn(instances, instance)) throw new Error("K2_FIXED_INSTANCE_REQUIRED");
const config = instances[instance];
const credentials = JSON.parse(readFileSync(`/tmp/${instance}-credentials.json`, "utf8"));
if (credentials.instance !== instance || credentials.adminUser !== "Admin" || typeof credentials.adminPassword !== "string") throw new Error("K2_INVALID_CREDENTIAL_FILE");

const session = await login();
const created = await api({
  action: "wbeditentity", new: "item", token: session.token,
  data: JSON.stringify({ labels: { en: { language: "en", value: config.label }, ja: { language: "ja", value: `${instance} 隔離試験項目` } } }),
  summary: `K2 bounded fixture for ${instance}`,
}, session.cookie, true);
const entityId = created.data.entity?.id;
if (!/^Q[1-9][0-9]*$/u.test(entityId)) throw new Error("K2_ENTITY_CREATE_FAILED");

const upload = await uploadFile(session);
if (upload.data.upload?.result !== "Success") throw new Error("K2_UPLOAD_FAILED");
process.stdout.write(`${JSON.stringify({ instance, label: config.label, entityId, revision: Number(created.data.entity.lastrevid), upload: upload.data.upload.filename })}\n`);

async function login() {
  let response = await api({ action: "query", meta: "tokens", type: "login" });
  response = await api({ action: "login", lgname: credentials.adminUser, lgpassword: credentials.adminPassword, lgtoken: response.data.query.tokens.logintoken }, response.cookie, true);
  if (response.data.login?.result !== "Success") throw new Error("K2_LOGIN_FAILED");
  const csrf = await api({ action: "query", meta: "tokens" }, response.cookie);
  return { cookie: csrf.cookie, token: csrf.data.query.tokens.csrftoken };
}
async function uploadFile(session) {
  const body = new FormData();
  const filename = `${instance}-fixture.png`;
  for (const [key, value] of Object.entries({ action: "upload", format: "json", formatversion: "2", filename, token: session.token, comment: `K2 bounded upload for ${instance}`, ignorewarnings: "1" })) body.set(key, value);
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  body.set("file", new Blob([png], { type: "image/png" }), filename);
  const response = await fetch(`${config.base}/api.php`, { method: "POST", headers: { cookie: session.cookie }, body });
  if (!response.ok) throw new Error(`K2_UPLOAD_HTTP_${response.status}`);
  return { data: await response.json() };
}
async function api(parameters, cookie = "", post = false) {
  const values = { format: "json", formatversion: "2", ...parameters };
  const response = post
    ? await fetch(`${config.base}/api.php`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams(values) })
    : await fetch(`${config.base}/api.php?${new URLSearchParams(values)}`, { headers: cookie ? { cookie } : {} });
  if (!response.ok) throw new Error(`K2_HTTP_${response.status}`);
  const cookies = new Map(cookie.split("; ").filter(Boolean).map(value => [value.split("=", 1)[0], value]));
  for (const value of response.headers.getSetCookie?.() ?? []) { const pair = value.split(";", 1)[0]; cookies.set(pair.split("=", 1)[0], pair); }
  return { data: await response.json(), cookie: [...cookies.values()].join("; ") };
}
