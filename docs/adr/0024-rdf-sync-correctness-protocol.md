# ADR-0024: Incremental RDF synchronization is revision-fenced and rebuildable

- Status: Accepted for PoC; production worker remains unapproved
- Date: 2026-08-19

## Decision

Persist a source cursor `(wiki identity, timestamp, rcid)` and an independent `indexedRevision` fence per entity. Fetch the exact revision, stage a complete entity graph, verify it, replace it, and advance the fence last. An ambiguous write, lifecycle event, cursor retention loss, source identity change, or revision mismatch transitions to `REBUILD_REQUIRED`; it never falls back to latest-wins.

Entity graphs and the versioned global/property-schema graph are separate. Full rebuild uses a new dataset generation: capture C0, dump to staging while retaining events, capture C1, replay `(C0,C1]` with fences, verify, then switch the configured dataset reference. Backends lacking a proven atomic switch must stop serving or report stale during cutover.

RecentChanges `rcid` values are monotonic cursor components, not a gap-free sequence. Deleted revisions can disappear from RecentChanges. The per-entity `old_revid` chain detects edit gaps. Lifecycle log records and stable redirect tags/autosummary keys are resolved with an upstream entity/page fetch; the mutable `redirect` flag alone is not historical evidence.

## Consequences

- Retry is at-least-once and idempotent; cursor/fence updates occur only after verified graph state.
- Delete removes only the entity graph. Undelete refetches its restored exact revision. Merge refreshes both source and target records; the source normally becomes a redirect.
- Fuseki, Virtuoso, and Oxigraph support staging graphs, but M4 does not prove atomic visibility of Graph Store replacement or portable atomic dataset alias switching. All are `SAFE_WITH_REBUILD_FALLBACK`, not `PROVEN_ATOMIC`.
- M5 must implement durable transactions/leases, retention-loss detection, backend-specific generation cutover, and operator-visible rebuild controls before continuous synchronization.
