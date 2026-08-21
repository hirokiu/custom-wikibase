# Japan Wikibase M9D Generation Coordinator qualification

## Result

M9D completed locally on 2026-08-20 JST. Virtuoso, Oxigraph, and Fuseki/TDB2
each passed the actual-process E–M2 crash matrix, promotion-time PostgreSQL
outages, two-Coordinator contention, journaled cleanup, post-promotion update,
and final canonical Dataset equality (0/0).

Combined with the unchanged real Wikibase/RecentChanges/Worker evidence and
30-minute Virtuoso soak from M9B, the result is:

`LOCAL_DURABLE_RDF_SYNC_QUALIFIED`

No connection was made to utirik, production, DNS, GitHub Actions, Controller,
or Wikidata. Only fixed Docker Desktop resources were mutated and removed.

## Architecture and durable state

The deployable `rdf-generation-coordinator` reads and advances PostgreSQL state,
uses `LocalComposeGenerationDriver` only with allowlisted backend profiles and
generation IDs, observes generation-scoped sync evidence, and asks two read-only
Routers whether the committed pointer version is visible. It does not poll
RecentChanges or apply RDF changes.

Rebuild operations persist request key, source, query service, candidate,
backend, normalization/partition models, reason, snapshot/target cursors,
lease owner, expiry, and fence. The request key is unique, while the generation
row is also unique by source and generation, so replay cannot allocate a second
candidate. State is reconstructable as:

`REBUILD_REQUESTED -> CREATING_GENERATION -> LOADING_SNAPSHOT -> WAITING_FOR_CATCHUP -> VALIDATING -> READY_TO_PROMOTE -> PROMOTING -> PROMOTED -> ROLLBACK_PROTECTED`

Cleanup uses `CLEANING_UP -> COMPLETED`; `FAILED` and `AMBIGUOUS` are explicit
fail-closed terminal states. Snapshot load completion is not inferred from
SPARQL health: durable sync state must exist. Promotion requires target cursor,
zero failed/gap entity fences, CURRENT schema, correct models, VALID result and
manifest, then uses the separately journaled CAS sequence from ADR-0032.

## Crash and recovery evidence

All crash points used a real Coordinator child process and hard exit code 86,
then a fresh process. The pointer never selected a candidate implicitly.

| Point | Durable state at crash | Pointer | Recovery result |
|---|---|---|---|
| E candidate physically created | CREATING_GENERATION | A/v1 | same B reused; no duplicate row |
| F snapshot load | LOADING_SNAPSHOT | A/v1 | waits for durable load evidence |
| G catch-up | WAITING_FOR_CATCHUP | A/v1 | observes B cursor/fences; does not reset |
| H validation passed | VALIDATING | A/v1 | resumes with existing READY B |
| I journal prepared, before CAS | READY_TO_PROMOTE | A/v1 | PREPARING safely retried |
| J immediately after CAS | PROMOTING | B/v2 | committed pointer is authoritative |
| K Router verified, before metadata | PROMOTING | B/v2 | journal and A/B metadata finalized |
| L retirement | CLEANING_UP | B/v2 | resumes from RETIRING |
| M1 before delete | CLEANING_UP | B/v2 | repeats safe fixed-target delete |
| M2 after delete, before DB finalization | CLEANING_UP | B/v2 | absent backend accepted; metadata finalized |

After K, the journal was `COMMITTED/GENERATION_FINALIZED`, B was `SERVING`,
and A was retained as `RETIRING` and protected by the rollback pointer.

## Retirement and concurrency

The retirement journal records intent, delete-attempt time, physical-delete
time, and metadata-finalization time. Eligibility rejects the serving
generation, rollback generation, active promotion participants, active
candidate, unsupported backend mismatch, and any generation not explicitly
FAILED/RETIRED. Local policy therefore retains one serving and one rollback
generation. Repeated stop, retire, and delete succeeded for every driver.

Two Coordinator processes contended for one `gen-c` operation. PostgreSQL
`FOR UPDATE SKIP LOCKED`, lease ownership, and fence-checked transitions yielded
one generation row and one durable operation. A stale owner cannot transition
using another owner's fence.

PostgreSQL was physically stopped once after PREPARING/before CAS and once after
the CAS commit. The Coordinator stayed alive but made no fallback progress. On
recovery the pointer was respectively A/v1 and B/v2; no second promotion was
created.

## Health, logs, and metrics

`/livez` and `/readyz` returned 200 after initialization; readiness checks
PostgreSQL and does not require an idle rebuild queue. `/metrics` exports all
required counters/gauges, including zero values: requests, success/failure,
promotions/failures, rollbacks, retirements, cleanup, reconciliation, ambiguity,
and active rebuild/retirement counts. JSON logs are field-allowlisted and omit
credentials and environment dumps.

## Integrated regression and classification

Each physical backend completed A creation, B rebuild evidence, catch-up gate,
validation, CAS promotion, two-Router convergence, a post-promotion graph
replacement/cursor advance, failed-generation retirement, repeated physical
cleanup, and final canonical equality:

| Backend | E–M2 | DB outage | concurrency | stop/retire/delete replay | final diff | Classification |
|---|---:|---:|---:|---:|---:|---|
| Virtuoso | pass | pass | pass | pass | 0/0 | `QUALIFIED_LOCAL_DURABLE_SYNC` |
| Oxigraph | pass | pass | pass | pass | 0/0 | `QUALIFIED_LOCAL_DURABLE_SYNC` |
| Fuseki/TDB2 | pass | pass | pass | pass | 0/0 | `QUALIFIED_LOCAL_DURABLE_SYNC` |

M9B remains the evidence for real M1 entities, real RecentChanges, Workers,
complex Wikibase RDF, backend outages, and the 30-minute Virtuoso soak. M9D did
not rerun that soak because Coordinator code does not modify the continuous sync
path. M9D supplies the previously missing lifecycle evidence and a focused
physical-backend regression; these evidence categories are intentionally kept
separate.

The resulting role decision is:

- `DEFAULT_BACKEND = virtuoso`
- `REFERENCE_BACKEND = fuseki-tdb2`
- `LIGHTWEIGHT_BACKEND = oxigraph`

This is a local qualification, not production approval.

## Changed boundary and cleanup

M9D adds migration 010, the Coordinator PostgreSQL repository/runtime and unit
and integration tests, the deployable app with health/metrics/logging, the
fixed local qualification harness, ADR-0032, and this report. It extends only
the fixed local generation port allocation for `gen-c`.

Every qualification run removed PostgreSQL, A/B/C containers, networks, and
volumes. The existing M1 environment was left unchanged. Relevant M1–M9C
evidence was reused; the broad M9B and 30-minute soak were deliberately skipped.

Final regression results:

- `npm run check`: pass (140 tests: 132 pass, 8 expected PostgreSQL-dependent
  skips in the dependency-free run);
- `npm run test:postgres`: 7/7 pass, including the Coordinator repository;
- `npm run helm:check`: pass using pinned Helm 4.2.2;
- `npm run jwb:test`: pass on native ARM64 MediaWiki 1.43.9, Japanese,
  Wikibase API, and persistent Q1;
- `npm run jwb:coordinator:qualify -- --backend=...`: pass for all three
  backends, with E–M2 exit 86 and final 0/0 each.

No M1–M9C broad qualification harness or 30-minute soak was rerun. Their
evidence is unchanged, and the new Coordinator does not enter the Worker data
path. No GitHub Actions job was triggered.

## Recommended next milestone

M10 should package the Generation Coordinator for a disposable local k3d
environment, replace the local Compose physical driver with a structured
Kubernetes generation driver, and repeat lifecycle tests there. Controller and
production integration must remain separately approved work.
