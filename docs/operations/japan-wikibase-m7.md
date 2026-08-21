# Japan Wikibase M7 query-router and physical-cutover report

## Classification

The logical read boundary and local physical A/B proof are complete, but the full automatic rebuild claim remains **INSUFFICIENT_EVIDENCE**. The mandatory real-M1 active-edit rebuild and 30-minute soak were not run in this iteration. No production, Controller, Wikidata, DNS, or GitHub Actions operation occurred.

## Architecture and pointer

`POST /sparql` is the only query route. `/livez`, `/readyz`, and `/metrics` are internal health routes. On every request the router reads `(query_service_id, source_identity, generation_id, previous_generation_id, version)` from PostgreSQL, validates the generation against an immutable target registry, and makes one upstream request. This gives request-boundary consistency: an in-flight request remains on its selected generation; a later request observes the newly committed pointer.

Migration 007 adds the query-service and serving-pointer tables. Promotion locks the pointer row, requires the expected version and old generation, requires a `READY`/`VALID` candidate, and atomically commits pointer, lifecycle, and journal changes. Rollback performs the inverse CAS. A real PostgreSQL concurrency test proves that exactly one of two writers succeeds and that a stale rollback fails closed.

Two independent router objects sharing one pointer were exercised before and after promotion. Both returned 20/20 `OLD_COMPLETE` and then 20/20 `NEW_COMPLETE`; both reloaded pointer version 2 on the next request. This models two processes because no mutable routing state is shared beyond the pointer repository.

## Security boundary

The router accepts `SELECT`, `ASK`, `CONSTRUCT`, and `DESCRIBE`; it rejects SPARQL Update and `SERVICE`. Request size is 64 KiB, response size 5 MB, and upstream timeout 10 seconds by default. Targets must be fixed allowlisted local generation endpoints. Client credentials and backend administration/update paths are never forwarded or exposed. Errors are reduced to bounded error codes. Liveness is process-only; readiness requires a valid, healthy serving target.

## Physical results on Apple Silicon Docker Desktop

Each run used two separate containers and two separate named volumes. The candidate was loaded while all 30 logical queries continued to return `OLD_COMPLETE`; before promotion 100/100 were old, after promotion 100/100 were `NEW_COMPLETE`, and after rollback 50/50 were old. There were zero empty, partial, invalid, or connection-error classifications. Cleanup removed both disposable projects and volumes.

| Backend | A+B memory | direct mean | routed mean | measured delta | pointer switch |
|---|---:|---:|---:|---:|---:|
| Fuseki/TDB2 | 1511.2 MiB | 4.954 ms | 4.555 ms | -0.399 ms | 0.087 ms |
| Virtuoso | 264.4 MiB | 2.141 ms | 2.136 ms | -0.005 ms | 0.063 ms |
| Oxigraph | 40.7 MiB | 0.880 ms | 1.293 ms | +0.413 ms | 0.083 ms |

The negative deltas are timing noise in 30 small local queries, not a speedup claim. CPU was effectively idle after loading. Block I/O was recorded in command output; the short run does not establish steady-state disk cost.

## Crash and lifecycle assessment

Before pointer commit, a crash leaves A serving and B independently ready. PostgreSQL transaction rollback covers failure while the row lock is held. Pointer, generation states, and journal commit atomically, so a database-visible pointer/state split is not produced by the repository. A router that has already selected A may finish that one request while another selects B; this is the documented request-boundary guarantee. Stale writers and unregistered targets fail closed. Restart readiness reloads and health-checks the pointer target.

Physical process-kill injection at every A–G point, ambiguous-journal repair, retirement deletion guards, and automatic coordinator-to-Compose lifecycle wiring remain unproven. The harness always retains A until rollback and then idempotently removes both fixed local projects.

## Cross-backend and real-Wikibase scope

The harness supports `--candidate=<allowlisted backend>`. The executed Virtuoso-to-Oxigraph run returned 30/30 old during candidate load, 100/100 old before promotion, 100/100 new after promotion, and 50/50 old after rollback, with no error class. The pointer switch measured 0.088 ms; the pair used 123.1 MiB when sampled. It uses equivalent test RDF and a stable logical query, not a full canonical Wikibase RDF snapshot.

The mandatory active-edit rebuild, canonical equality against a fresh M1 dump, worker/router restart sequence, cursor/fence regression check, and 30-minute soak were not run (duration: 0 minutes). Consequently this is not yet the first full physical automatic-rebuild proof.

## Capability and recommendation

`QUERY_SERVING_CAPABILITIES` records the router-owned guarantees: isolated fixed targets, request-boundary cutover, CAS pointer, rollback, and replica convergence. RDF product profiles remain false for `isolatedGenerations`, `atomicServingCutover`, and `rollbackCutover`; physical runtime creation is still a harness concern rather than an `RdfBackend` adapter implementation.

Backend selection remains **INSUFFICIENT_EVIDENCE** for a production default. Current local evidence supports Virtuoso as the compatibility/reference backend, Fuseki as a primary standards-oriented target, and Oxigraph as the lightweight candidate; it is insufficient to name `DEFAULT_BACKEND`.

## Future Controller contract

The future read-only projection should expose logical endpoint, backend type, serving and candidate generation IDs, synchronization state/freshness, router readiness, backend health, pointer version, and promotion state. Mutations should remain Controller API → generation coordinator → structured physical driver; never arbitrary shell or URL input.
