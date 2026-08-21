# Japan Wikibase M8 automatic rebuild qualification report

## Outcome

Overall classification remains **INSUFFICIENT_EVIDENCE**. M8 added real-Wikibase physical qualification and recovery/retention primitives, but did not complete the durable RecentChanges worker path, the full physical A–K crash matrix, or the mandatory 30-minute soak. No production, utirik, Controller, Wikidata, DNS, or GitHub Actions operation occurred.

## Runtime topology exercised

The source was the native ARM64 M1 MediaWiki 1.43.9/Wikibase and MariaDB/Job Runner. Two independent backend containers and volumes represented A and B. The M7 read-only Query Router retained the stable logical query boundary. The executable M8 harness captured C0, loaded A, checked equality, loaded B while real API edits ran, captured C1, replaced B with C1, checked equality, promoted, restarted B, queried B, and rolled back to A.

This is deliberately reported as a partial qualification: C1 replacement is not RecentChanges catch-up replay and uses an in-memory pointer in the physical harness. PostgreSQL CAS remains independently integration-tested.

## Real data and edits

The deterministic source contained Items, seven Properties, Japanese/English labels, descriptions, aliases, strings, external IDs, item-valued statements, quantities, dates, a qualifier, and a reference. Each backend run made real MediaWiki API revisions for an Item label, Property label/schema mutation, and statement value, plus a real delete/undelete cycle. No RDF store was edited as the source of truth.

The source had 354 triples in each measured C0/C1 snapshot. The unchanged count is expected because mutations replaced terms and the delete was followed by undelete before C1.

## Canonical equality gate

For A and B on all runs: canonical triples 354, generation triples 354, comparable `full-only=0`, `generation-only=0`. Twenty-eight canonical and 28 exported lines containing RDF blank-node identifiers were excluded from line identity comparison because each backend may legally relabel Property-schema blank nodes. Counts are recorded, but this is not full RDF dataset canonicalization; URDNA-style blank-node canonicalization remains M9 work.

## Backend results

| Run | Result | A+B sampled memory | Catch-up replacement | Promotion |
|---|---|---:|---:|---:|
| Virtuoso → Virtuoso | partial pass | 221.8 MiB | 17 ms | 0.078 ms |
| Oxigraph → Oxigraph | partial pass | 40.7 MiB | 5 ms | 0.072 ms |
| Fuseki → Fuseki | partial pass | 1145.3 MiB | 62 ms | 0.068 ms |
| Virtuoso → Oxigraph | partial pass | 119.3 MiB | 4 ms | 0.063 ms |

Every run observed only: old 20 during initial candidate work, old 20 after the C0 race, old 50 before promotion, new 50 after promotion, new 20 after candidate restart, and old 30 after rollback. There were no EMPTY, PARTIAL, INVALID, or connection-error results. Identity was derived internally from the selected generation, without changing canonical RDF.

Rollback returned A as **stale-but-complete at C0**. Freshness must therefore be surfaced separately from availability/correctness.

## Recovery and cleanup

Startup reconciliation now classifies consistent state, serving backend unavailable, pointer target missing, pointer/registry mismatch, incomplete promotion ambiguity, and an unused READY candidate. It never repairs ambiguity automatically. Unit tests cover these rules.

Retention protects the serving generation, rollback generation, generations referenced by a `PREPARING` journal, and optionally the newest failed generation. The structured retirement coordinator deletes only selected `RETIRED`/`FAILED` generations and retries safely after a crash between physical and registry deletion. The local physical harness removed all of its A/B containers, volumes, and networks.

Not physically injected: worker crash, snapshot-load interruption, PostgreSQL outage, pointer/metadata split, rollback crash, retirement crash, and cleanup crash against all real backends. Transaction and pure-state tests do not substitute for this matrix.

## Qualification and backend decision

| Backend | Classification | Reason |
|---|---|---|
| Virtuoso | `INSUFFICIENT_EVIDENCE` | real equality/cutover/restart passed; no durable worker crash matrix or 30-minute soak |
| Oxigraph | `INSUFFICIENT_EVIDENCE` | real equality/cutover/restart passed; long-lived RocksDB/update growth untested |
| Fuseki/TDB2 | `INSUFFICIENT_EVIDENCE` | real equality/cutover/restart passed; durable worker path and soak untested |

No `DEFAULT_BACKEND` is selected. Virtuoso remains the operational default candidate, Fuseki/TDB2 the reference candidate, and Oxigraph the lightweight candidate. Product `atomicServingCutover` remains false; the physical generation driver demonstrates isolation, the router demonstrates request-boundary cutover, but the full platform guarantee remains unqualified.

## Soak and exact skips

The M8 real 30-minute soak duration was **0 minutes** and is not claimed. Continuous periodic edits, worker/router restarts, candidate restart, delete/undelete, Property mutation, lag monitoring, and final equality were not combined into a 30-minute durable run. The A–K physical crash matrix and true RecentChanges C0→C1 replay were also skipped.

## Future Controller contract

The future projection contains `enabled`, `backendType`, `logicalEndpoint`, operational `backendHealth` and `routerHealth`, synchronization `syncState`, `lagSeconds`, `lastSuccessfulSync`, serving/rollback/candidate generation IDs, `rebuildState`, `lastPromotion`, pointer version, ambiguity classification, and separate backend/driver/router/platform capability summaries. Controller integration remains deferred.

## Distribution implication and M9

Profiles should remain conceptual: `core`, `query-virtuoso`, `query-oxigraph`, `query-fuseki`, plus the existing WBS/WDQS compatibility profile.

M9 should connect a fixed local physical-generation driver to the durable PostgreSQL coordinator and real worker, implement RDF blank-node canonicalization, replay post-C0 RecentChanges with revision fences, persist/query the actual Router pointer, add a restartable 30-minute scenario runner, and execute the complete A–K crash matrix before any backend capability or default is promoted.
