# Japan Wikibase M9B full integrated qualification report

## Result

The repaired M9C contracts were exercised from fresh state on 2026-08-19 UTC
(2026-08-20 JST). The result remains **INSUFFICIENT_EVIDENCE**. RDF correctness,
durable worker, Router, outage, and mandatory Virtuoso soak gates passed, but
there is no real Generation Coordinator runtime for crash points E–M and
retirement metadata finalization. Partial execution is not qualified.

No connection to utirik, production, Controller, DNS, GitHub Actions, or
Wikidata was made. Mutable resources stayed in Docker Desktop and disposable M1.

## Fresh baseline and topology

Prior M9B generations, PostgreSQL state, cursors, fences, and promotions were
not reused. Dataset run `20260819145404` created Items Q5–Q7 and Properties
P12–P18. Its manifest covers Japanese/English terms, descriptions, aliases,
string, external identifier, Item, quantity, time, qualifier, reference, and
disposable lifecycle entities. The baseline had 846 triples and SHA-256
`5423c164181db2e12dba266e2a7cb80f3187fa7dd3fc528da06f4f9471187933`.

Each backend run used fresh PostgreSQL 16, physical A/B volumes, source cursor,
generation fences, and serving pointer. Actual processes included ARM64
MediaWiki 1.43.9/Wikibase, Job Runner, MariaDB, Source Reader, generation-bound
Workers, and two Query Routers. The contracts were
`jwb-rdf-normalization-v1` and `jwb-partition-v1`.

Snapshot/equality orchestration still runs in the local harness through
structured classes. There is no deployable Generation Coordinator process.

## Completed correctness evidence

All fresh deterministic runs completed canonical bootstrap, real RecentChanges
replay from C0, independent A/B fences, Property entity/schema synchronization,
Item and Property delete/undelete, readiness checks, canonical equality, CAS
promotion, two-Router convergence, post-promotion sync, rollback freshness, and
explicit return to B. B catch-up did not use a C1 snapshot.

| Path | Equality | Promotion/post-sync | A–D crash | DB/backend outage |
|---|---:|---:|---:|---:|
| Virtuoso A → Virtuoso B | 0 / 0 | pass | pass | pass |
| Oxigraph A → Oxigraph B | 0 / 0 | pass | pass | pass |
| Fuseki A → Fuseki B | 0 / 0 | pass | pass | pass |
| Virtuoso A → Oxigraph B | 0 / 0 | pass | pass | pass |

The A–D matrix used real worker processes and hard exit 86 at
`AFTER_RC_FETCH`, `AFTER_RDF_FETCH`, `AFTER_BACKEND_UPDATE`, and
`AFTER_FENCE_BEFORE_CURSOR`. Every case restarted, replayed idempotently,
advanced B-specific state, preserved the serving pointer, and converged.

Candidate outage left A serving and B behind its target. Serving outage caused
query failure without pointer movement or automatic candidate selection. During
PostgreSQL outage the Router failed closed and did not serve a cached pointer.
The current pool does not reliably restore Router readiness, so both Routers
were explicitly restarted after DB recovery. Source Reader now retries bounded
polls and idle pool errors no longer terminate the three runtimes.

## Virtuoso integrated soak

The mandatory run lasted at least 1,800 seconds wall-clock. It included fresh
A/B rebuild, RC catch-up, promotion, Worker/Router/backend restarts, PostgreSQL
outage/recovery, Property and qualifier/reference changes, delete/undelete, and
continuing label edits.

- 1,685 logical responses were `NEW_COMPLETE`; no EMPTY/PARTIAL was observed.
- serving cursor advanced from rcid 223 to 287;
- real edits waited for the B durable fence before being counted;
- Virtuoso B stayed approximately 125–127 MiB in retained samples;
- PostgreSQL stayed approximately 30–33 MiB;
- ASK latency was generally single-digit to mid-teen milliseconds;
- no unexplained Virtuoso exit or increasing backlog appeared.

Final fresh dump versus serving Virtuoso B:

```text
canonical-only quads = 0
generation-only quads = 0
graph count = 61
checksum = 992c62f1f52c2339d793806dc440462ae4229fed3a5d8c0a5a7108c0a7b958c6
```

This is local correctness evidence, not production lifetime extrapolation.

## Defects fixed during qualification

- repeatable dataset generation now uses a run-specific Property label;
- Router readiness uses backend-neutral SPARQL `POST ASK`, required by Fuseki;
- successful durable commit clears a prior transient `error_code`;
- Source Reader retries temporary DB failures;
- runtime pools handle idle connection errors;
- Worker accepts only four allowlisted local hard-crash points;
- the outage DB binds only to `127.0.0.1:15439` and the harness recreates its
  own pool after recovery.

## Missing mandatory evidence

E–M were not executed because no actual Generation Coordinator runtime or
durable operation journal exists for generation create/load reconciliation,
catch-up/equality/READY reconciliation, CAS metadata finalization, retirement,
or physical-delete finalization. The required
`RETIRING → RETIRED → deletion → metadata finalization` state machine is also
unqualified. Harness cleanup removed fixed disposable resources, but is not a
substitute for journaled retirement.

## Classification

| Target | Classification | Reason |
|---|---|---|
| Virtuoso | `INSUFFICIENT_EVIDENCE` | worker/data/soak passed; E–M and retirement missing |
| Oxigraph | `INSUFFICIENT_EVIDENCE` | deterministic/migration passed; E–M and retirement missing |
| Fuseki/TDB2 | `INSUFFICIENT_EVIDENCE` | deterministic passed; E–M and retirement missing |
| Overall | `INSUFFICIENT_EVIDENCE` | no backend completed every mandatory gate |

`DEFAULT_BACKEND`, `REFERENCE_BACKEND`, and `LIGHTWEIGHT_BACKEND` remain unset.
Virtuoso, Fuseki, and Oxigraph remain the leading default, reference, and
lightweight candidates respectively, but this is not a final selection.

## Layered capability model

- canonical RDF contract: `normalizationModel`, `partitionModel`;
- RDF backend: SPARQL query/update, graph operations, persistence;
- generation driver: isolated create/start/restart/retire/delete;
- query serving: logical endpoint, PostgreSQL pointer, CAS, rollback,
  request-boundary cutover;
- synchronization: RecentChanges, replay, lifecycle, generation fences,
  rebuild/catch-up, schema currency, freshness.

These must not be flattened into `backend.capabilities`.

## Controller-facing proposal (not integrated)

```json
{
  "queryService": {
    "enabled": true,
    "backendType": "virtuoso",
    "logicalEndpoint": "controller-managed logical URL",
    "normalizationModel": "jwb-rdf-normalization-v1",
    "partitionModel": "jwb-partition-v1",
    "health": { "backend": "healthy", "router": "healthy" },
    "synchronization": {
      "state": "healthy",
      "freshness": "current",
      "lagSeconds": 0,
      "lastSuccessfulSync": "timestamp",
      "sourceCursor": { "timestamp": "timestamp", "rcid": 287 }
    },
    "serving": { "generationId": "gen-b", "pointerVersion": 4 },
    "rollback": { "generationId": "gen-a", "freshness": "stale" },
    "rebuild": { "state": "blocked_until_coordinator_runtime" }
  }
}
```

Controller integration is intentionally not implemented.

## Next boundary

Implement a structured Generation Coordinator entry point and PostgreSQL
operation journal with fixed operations and identifiers—no shell fragments or
arbitrary backend commands. Then execute E–M, retirement/cleanup, and rerun the
mandatory classification. Production remains out of scope until it passes.
