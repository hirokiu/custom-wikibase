# ADR-0029: M9 qualification is blocked on a generation-scoped dataset contract

Status: problem accepted; replacement contract not yet selected

## Context

Integration showed that bootstrap loads a default dataset while incremental synchronization replaces entity named graphs. PostgreSQL stores one entity fence per source/entity, although serving and candidate generations must catch up independently. Property events set `GLOBAL_SCHEMA_STALE`, but no runtime operation refreshes and clears the global schema partition.

## Decision

Do not connect these components into an automatic promotion pipeline and do not infer qualification from a complete C1 reload. Qualification remains fail-closed until one consistent generation-scoped storage/query contract is selected and implemented.

Any replacement must preserve established revision-continuity and Router CAS semantics. It must add generation-scoped fences, identical bootstrap/incremental graph layout, deterministic Property/global schema replacement, backend-neutral logical query dataset semantics, and RDF Dataset equality. The exact schema and graph layout are deferred to a focused follow-up ADR.
