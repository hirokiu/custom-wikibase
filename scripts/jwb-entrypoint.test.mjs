import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Japan Wikibase releases the install lock before exec", () => {
  const source = readFileSync(
    new URL("../infrastructure/japan-wikibase/entrypoint.sh", import.meta.url),
    "utf8",
  );
  const unlock = source.indexOf("flock -u 9");
  const close = source.indexOf("exec 9>&-");
  const runtimeExec = source.lastIndexOf('exec "$@"');
  assert.ok(unlock > 0);
  assert.ok(close > unlock);
  assert.ok(runtimeExec > close);
});
