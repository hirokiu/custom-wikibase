# ADR-0032: RDF generation lifecycle is coordinated from durable evidence

Status: accepted

## Decision

Generation creation, readiness observation, promotion, rollback protection, and
retirement are owned by a dedicated Generation Coordinator process. The
Coordinator derives correctness from PostgreSQL operation, promotion,
retirement, serving-pointer, generation, and synchronization records plus the
fixed physical-generation driver and read-only Router observations.

The Coordinator never polls RecentChanges, writes entity RDF, changes revision
fences, accepts backend URLs, or executes caller-supplied commands. Those remain
RDF Sync Worker or fixed-driver responsibilities.

Each operation is claimed using a PostgreSQL lease and monotonically increasing
fence. Transitions require operation ID, owner, fence, prior state, and an
unexpired lease. Promotion uses a separate journal and compare-and-swap pointer:

`PREPARING -> POINTER_UPDATED -> ROUTER_VERIFIED -> GENERATION_FINALIZED`

Retirement is independently journaled:

`ROLLBACK_PROTECTED -> RETIRING -> RETIRED -> PHYSICAL_DELETE_PENDING -> PHYSICALLY_DELETED -> METADATA_FINALIZED`

The serving and previous (rollback) pointer generations, active candidates,
incomplete promotions, and ambiguous states are ineligible for cleanup.
Physical deletion is allowlisted by validated generation ID and backend profile
and is idempotent when the fixed resource is already absent.

## Consequences

- A restart can resume from database and physical evidence without process
  memory.
- A pointer committed before a crash is not implicitly rolled back.
- PostgreSQL loss makes progress stop; there is no local fallback pointer.
- Query Router remains read-only and cannot promote or delete.
- Controller and Kubernetes production packaging remain outside this decision.
