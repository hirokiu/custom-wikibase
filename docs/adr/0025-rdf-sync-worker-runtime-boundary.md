# ADR-0025: RDF sync worker remains fail-closed at generation cutover

- Status: Accepted local runtime; physical rebuild cutover deferred
- Date: 2026-08-19

## Decision

The M5 worker persists its RecentChanges cursor and per-entity revision fences in PostgreSQL, replaces complete entity named graphs through `RdfBackend`, and transitions to `REBUILD_REQUIRED` for gaps, ambiguous lifecycle state, Property schema invalidation, or uncertain writes. Backend process health and synchronization state remain independent.

A rebuild is modeled as staging generation, bounded catch-up, verification, and active-generation cutover. The model and crash semantics are implemented and tested. It is not wired to the current HTTP backends because the accepted `RdfBackend` contract has no active-generation pointer, query router, or atomic dataset swap. Performing `CLEAR`, `DROP/ADD`, or Graph Store PUT against the serving dataset would contradict ADR-0024. Local Compose auto-rebuild and Controller integration therefore remain disabled.

All backend HTTP requests have a fixed 30-second abort timer. This fixes Node exit code 13 when the first request to a newly started backend remains an unresolved top-level await without a referenced event-loop handle.

## Consequences

- Incremental worker-core conformance is supported for Fuseki/TDB2, Virtuoso, and Oxigraph.
- No backend is approved as the production default from M5 evidence.
- M6 must extend the backend contract with explicit generation lifecycle and prove physical isolation/cutover separately per backend before enabling automatic rebuild or a query profile.
