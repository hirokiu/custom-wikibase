# ADR-0028: Automatic rebuild recovery is evidence-driven and fail-closed

Status: accepted

## Decision

Startup reconciliation reads the PostgreSQL serving pointer, generation registry, promotion journal, and health of each fixed physical target. It becomes ready only when the pointer identifies the sole registry `SERVING` generation and that target is healthy. Missing targets, registry disagreement, unavailable serving targets, and incomplete promotion journals are explicit classifications; no generation is silently selected or mutated.

Local retention keeps one serving generation, one rollback generation, and at most one newest failed generation. Cleanup accepts only `RETIRED` and unprotected `FAILED` records. It is implemented through a structured generation driver, never shell input. Physical deletion is idempotent because a crash can occur before the corresponding durable registry deletion.

## Qualification boundary

Canonical C1 replacement can demonstrate physical equality and routing but is not evidence of RecentChanges replay or revision-fence recovery. A backend cannot be marked automatic-rebuild-qualified until the durable worker, physical generation driver, router, and PostgreSQL journal participate in one real active-edit and crash-tested run.
