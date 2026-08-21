#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  JWB_BASE_URL,
  JWB_DOCKER_CONTEXT,
  JWB_STATE_FILE,
  assertJwbDockerTarget,
  stateEnvironment,
} from "./jwb-lib.mjs";
assertLocal();
const state = JSON.parse(readFileSync(JWB_STATE_FILE, "utf8"));
stateEnvironment(state);
const manifest = JSON.parse(
    readFileSync(
      new URL("../artifacts/jwb-m3/entity-manifest.json", import.meta.url),
      "utf8",
    ),
  ),
  entityId = manifest.q2,
  title = `Item:${entityId}`,
  before = await entityInfo(entityId),
  session = await login(),
  deleted = await post(session, {
    action: "delete",
    title,
    reason: "M9C lifecycle evidence",
  }),
  afterDelete = await entityInfo(entityId),
  deleteRdf = await fetch(
    `${JWB_BASE_URL}/wiki/Special:EntityData/${entityId}.nt`,
  ),
  undeleted = await post(session, {
    action: "undelete",
    title,
    reason: "M9C lifecycle evidence",
  }),
  afterUndelete = await entityInfo(entityId),
  undeleteRdf = await fetch(
    `${JWB_BASE_URL}/wiki/Special:EntityData/${entityId}.nt`,
  ),
  events = await recent(title);
const result = {
  version: 1,
  capturedAt: new Date().toISOString(),
  entityId,
  before,
  delete: {
    logId: deleted.logid ?? null,
    api: afterDelete,
    entityDataStatus: deleteRdf.status,
  },
  undelete: {
    apiRevision: undeleted.pageinfo?.lastrevid ?? null,
    entity: afterUndelete,
    entityDataStatus: undeleteRdf.status,
    hasRevisionEvidence: (await undeleteRdf.text()).includes(
      `<http://schema.org/version> "${afterUndelete.lastrevid}"`,
    ),
  },
  recentChanges: events.map((value) => ({
    rcid: value.rcid,
    timestamp: value.timestamp,
    type: value.type,
    revid: value.revid ?? null,
    oldRevid: value.old_revid ?? null,
    logtype: value.logtype ?? null,
    logaction: value.logaction ?? null,
    title: value.title,
  })),
};
const directory = new URL("../artifacts/jwb-m9c/", import.meta.url).pathname;
mkdirSync(directory, { recursive: true });
writeFileSync(
  `${directory}lifecycle-evidence.json`,
  `${JSON.stringify(result, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
async function entityInfo(id) {
  const value = await api({ action: "wbgetentities", ids: id, props: "info" });
  const entity = value.entities?.[id];
  return {
    missing: entity?.missing !== undefined,
    lastrevid: entity?.lastrevid ?? null,
  };
}
async function recent(pageTitle) {
  const value = await api({
    action: "query",
    list: "recentchanges",
    rctitle: pageTitle,
    rclimit: "10",
    rcprop: "title|ids|timestamp|loginfo",
  });
  return value.query.recentchanges;
}
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
  const value = await request(
    { ...parameters, token: session.token },
    session.cookie,
    true,
  );
  if (value.data.error) throw new Error(value.data.error.code);
  return value.data;
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
  if (!response.ok) throw new Error(`MediaWiki HTTP ${response.status}`);
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
