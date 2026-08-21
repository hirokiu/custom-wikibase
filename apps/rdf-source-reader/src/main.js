#!/usr/bin/env node
import pg from "pg";
import { loadSourceReaderConfig } from "./config.js";
import { MediaWikiRecentChangesSource } from "../../../services/rdf-sync/src/mediawiki-change-source.js";
import { PostgresSourceIngestionRepository } from "../../../services/rdf-sync/src/postgres-generation-sync-repository.js";
const config = loadSourceReaderConfig(),
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 2,
    connectionTimeoutMillis: 5000,
  }),
  repository = new PostgresSourceIngestionRepository({
    pool,
    sourceIdentity: config.sourceIdentity,
  }),
  source = new MediaWikiRecentChangesSource({
    apiUrl: `${config.sourceUrl}/api.php`,
    sourceIdentity: config.sourceIdentity,
  });
pool.on("error", () => {});
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stopping = true;
  });
process.stdout.write(
  JSON.stringify({
    event: "rdf_source_reader_started",
    sourceIdentity: config.sourceIdentity,
  }) + "\n",
);
while (!stopping) {
  try {
    const cursor = await repository.loadCursor(),
      result = await source.read(cursor, config.pageSize);
    for (const event of result.events)
      await repository.advanceCursor({
        sourceIdentity: config.sourceIdentity,
        timestamp: event.timestamp,
        rcid: event.rcid,
      });
    if (result.events.length)
      process.stdout.write(
        JSON.stringify({
          event: "rdf_source_cursor_advanced",
          count: result.events.length,
          rcid: result.events.at(-1).rcid,
        }) + "\n",
      );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ event: "rdf_source_poll_failed", code: "SOURCE_POLL_FAILED" })}\n`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
}
await pool.end();
