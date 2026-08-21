# Japan Wikibase M5 RDF synchronization worker local runtime

## Status

M5 completed the durable incremental worker core but did **not** pass the mandatory physical rebuild/cutover gate. Overall result: **`INSUFFICIENT_EVIDENCE`**. Automatic rebuild, optional query Compose profile, Controller integration, and production use remain disabled. No connection to `utirik`, production, Wikidata, or GitHub Actions occurred.

## 1–4. Architecture, persistence, polling, revision fence

`apps/rdf-sync-worker` contains strict local configuration, long-running bounded loop, `/livez`, `/readyz`, metrics, and safe JSON logging. Business logic is in `services/rdf-sync`; cursor/fence primitives are in `packages/rdf-sync`; migration 005 owns durable state.

PostgreSQL stores source identity, `(timestamp,rcid)`, overall status, poll/success timestamps, entity indexed/latest revisions and state, checksums, and rebuild cursors/state. It stores no RDF payload. `commitEvent` locks the source row and atomically commits entity fence plus cursor; equal/older cursor is rejected. Restart against a fresh repository instance retained cursor rcid 1 and Q1 revision 20 in integration testing.

Polling is bounded by interval, page size 1–100, batch size 1–100, ten-page same-second scan limit, fixed Item/Property namespaces, and local endpoint allowlist. Cursor advances after a successful verified graph write, or after a proven duplicate/older no-op. A malformed/unknown event stops the batch at its previous cursor.

The sequence `20,21,21,20,22` wrote three graphs, counted one duplicate and one out-of-order event, and ended at revision 22. A revision-chain gap made no backend write, retained the previous cursor, marked the entity `GAP`, and set the source to `REBUILD_REQUIRED`.

## 5–7. Lifecycle, global/schema, rebuild

Delete removes only `urn:jwb:entity:{id}` and records `DELETED`; repeated delete is idempotent. Undelete/redirect/merge use a fixed local MediaWiki resolver. It parses only stable IDs from accepted lifecycle metadata and verifies current canonical `wbgetentities` redirect/revision state. Ambiguity transitions to rebuild rather than guessing.

Property entity graphs use the same safe replacement, then mark `GLOBAL_SCHEMA_STALE` and `REBUILD_REQUIRED`. Selective global schema mutation is intentionally not attempted.

`GenerationRebuildCoordinator` implements the semantic sequence: create isolated generation, load snapshot, verify, replay `(C0,C1]`, verify, activate. An in-memory adapter proves that serving state stays unchanged before cutover and that 500 edits during rebuild converge exactly to the fresh canonical map.

The physical backend adapters cannot yet implement this contract. Current `RdfBackend` exposes graph CRUD/reset but no isolated generation, active pointer, atomic query routing, or dataset swap. Using serving `CLEAR`, `DROP/ADD`, or PUT would expose partial state and violate ADR-0024. This is the M5 stopping contradiction; no unsafe implementation was substituted.

## 8–9. Catch-up and crash recovery

Snapshot + bounded catch-up equivalence passed for a 500-event/5-entity burst. It is a strong state-map comparison, not a real RDF backend cutover test; the mandatory physical RDF equivalence gate is skipped pending generation adapters.

Crash injection passed after RC fetch at the polling boundary and at after RDF fetch, before backend write, after backend write, before fence commit, after fence/before cursor, during rebuild, before cutover, and after cutover. Before fence commit the revision remains old. After fence/before cursor, restart sees the committed entity revision and re-delivery becomes duplicate-safe. Ambiguous backend/fence divergence sets rebuild-required.

## 10. Virtuoso exit 13

Root cause was not Virtuoso image permissions, volume ownership, database initialization, or entrypoint. The minimal reproduction was: start a backend container and immediately make the first Node/undici fetch before its port is bound. A pending top-level await could have no referenced event-loop handle, causing Node exit code 13. Virtuoso exposed it more often because startup is slower; the new Fuseki worker harness reproduced the same failure.

The fix is a fixed 30-second referenced `AbortController` timer around every backend HTTP request, plus a timer before health probes. With phase tracing, Virtuoso passed startup, snapshot load, assertions, restart, named graph update, export, rebuild, reset, and cleanup. M2 measured startup 8,342 ms, load 22 ms, restart 2,290 ms, memory 111.5 MiB. A regression comment and phase tracing remain in the harness.

## 11–13. Backend worker results

The same synthetic worker-core scenario ran against each actual backend: revisions 1–4, duplicate, older delivery, backend restart, verification, and delete. Each ended with cursor 7, indexed revision 4 before delete, `DELETED` after delete, five applied operations, one duplicate, and one out-of-order observation.

| Backend | incremental worker | restart | delete | physical rebuild/cutover |
|---|---|---|---|---|
| Fuseki/TDB2 | pass | pass | pass | skipped: generation adapter absent |
| Virtuoso | pass | pass | pass | skipped: generation adapter absent |
| Oxigraph | pass | pass | pass | skipped: generation adapter absent |

This harness uses identical worker logic and events; PostgreSQL transaction durability is proven separately. It does not yet use a real M1 RecentChanges stream, qualifier/reference/quantity/time mutations, or one shared PostgreSQL run across all backends, so full backend worker conformance is not claimed.

## 14–16. Soak, resources, health

A 60-second worker-core soak processed 5,210 edits plus 744 duplicates at approximately 87 canonical edits/second. Fence ended at revision 5,210, cursor remained monotonic, exactly one graph remained, and heap grew 3,276,336 bytes (4,038,552 → 7,314,888). It is shorter than the requested 30–60 minute suggestion and did not use a real backend; long real-backend soak is skipped.

Previously measured resources remain: Fuseki about 361 MiB in M2, Virtuoso 111.5 MiB in the fixed run, Oxigraph about 10 MiB. These are observations, not a backend selection criterion.

`/livez` reports process liveness. `/readyz` requires DB access and responsive backend but does not require zero lag; it includes synchronization state. Metrics implemented: events seen/applied, duplicate/out-of-order/gap, entity failure, rebuild/rebuild failure, backend/rebuild duration, lag, current entities, failed entities. Structured logs allow only correlation ID, entity/revision/rcid/event/backend, result/error code, and duration; credentials, cookies, headers, and RDF are excluded.

## 17–19. QLever, WDQS, backend recommendation

QLever should use periodic verified batch generations or an aggregated federation snapshot/index. It should not adopt per-entity graph maintenance until its efficient incremental and atomic generation mechanism is proven.

Blazegraph/WDQS keeps the existing WDQS updater. M5 cursor/fence/rebuild semantics are comparison requirements, not a replacement implementation for existing WBS instances.

Backend decision remains **`INSUFFICIENT_EVIDENCE`**. Fuseki stays the reference backend, Oxigraph the lightweight backend, and Virtuoso an operational candidate whose exit-13 discrepancy is resolved. None passed physical generation cutover, real rebuild stress, and long real-backend soak.

## 20–22. Files, cleanup, exact M6

Added/changed areas:

- `apps/rdf-sync-worker`: config, runtime, health, metrics, logger, entrypoint.
- `packages/database/migrations/005_rdf_sync_runtime.sql`.
- `packages/rdf-sync/src/state.js` and existing protocol.
- `services/rdf-sync`: engine, PostgreSQL repository, lifecycle resolver, generation coordinator and tests.
- `services/rdf-backends/src/sparql-http-backend.js`: bounded requests.
- `scripts/jwb-m5-backend-worker.mjs`, `scripts/jwb-m5-soak.mjs`, M2 trace/fix.
- ADR-0025 and this report.

All backend conformance containers, networks, and volumes use fixed disposable projects and are removed in `finally`. PostgreSQL integration uses `--rm`; no local M1 environment was created for M5.

Exact M6 scope:

1. Extend `RdfBackend` with `createGeneration`, `loadGeneration`, `verifyGeneration`, `activateGeneration`, `discardGeneration`, and active-generation observation capabilities.
2. Implement isolated physical generations and query routing for Fuseki, Virtuoso, and Oxigraph independently.
3. Prove crash points G–I against actual backends, including process restart after cutover-before-state-commit.
4. Build an HTTP canonical snapshot source and versioned global/schema generation without shell execution.
5. Add a disposable local query profile only after one backend passes non-partial cutover.
6. Run one real M1 source, PostgreSQL, and each backend through qualifier/reference/quantity/time, delete/undelete, proven merge, worker restart, gap, rebuild, and fresh RDF equality.
7. Run a 30–60 minute real-backend soak and record bounded CPU/memory/lag.
8. Only then select a default candidate and propose the read-only Controller status contract. Controller mutation/API/UI remains out of scope.
