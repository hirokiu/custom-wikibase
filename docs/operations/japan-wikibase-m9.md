# Japan Wikibase M9 integrated durable synchronization report

## Outcome

M9 stopped at the explicit contract-consistency gate. Overall classification remains **INSUFFICIENT_EVIDENCE**. No backend was qualified and no default backend was selected. No production, utirik, Controller, Wikidata, DNS, or GitHub Actions operation occurred.

## Confirmed integration contradictions

### Snapshot dataset and incremental partitions are different physical views

The current physical bootstrap calls `replaceDataset()` and loads canonical Wikibase RDF into the backend default/selected dataset graph. The durable worker subsequently calls `replaceNamedGraph(urn:jwb:entity:Q/P...)`. Replacing an entity named graph does not remove the prior entity triples from the bootstrap default graph. A union query can therefore observe both old and new triples; a default-graph query can continue observing only stale bootstrap data. M7/M8 static cutover did not expose this because they reloaded the complete default dataset.

The logical Router forwards SPARQL without a dataset rewrite. Fuseki, Oxigraph, and Virtuoso do not currently share an adapter-defined “Wikibase union dataset” contract. Consequently the same public query cannot yet be proven to see the partitioned incremental state consistently across all three products.

### Revision fences are not generation-scoped

`rdf_sync_entity` is keyed by `(source_identity, entity_id)` and `rdf_sync_source` owns one cursor. During rebuild, serving A and candidate B require independent entity fences and catch-up cursors. Reusing the source fence may incorrectly classify a required candidate write as duplicate; resetting it would damage serving-generation durability. The current PostgreSQL schema cannot represent both states concurrently.

### Property/global schema stale has no resolving runtime path

The worker deliberately changes the source to `REBUILD_REQUIRED/GLOBAL_SCHEMA_STALE` after a Property event. The partitioner returns schema RDF, but `RdfSyncEngine` writes only `entityRdf`. There is no generation-scoped property/global-schema repository, aggregation rule, or atomic refresh operation that can clear the stale condition. M9 requires Property mutation during rebuild and prohibits promotion while this flag remains; the current coordinator cannot satisfy both rules.

### Runtime composition is incomplete

The worker is bound to one backend endpoint and has no generation selection. The PostgreSQL pointer repository and real Router entry point can be connected, but the current rebuild coordinator cannot hand a generation-scoped repository/backend to the worker. Proceeding with a harness-only substitution would violate the requirement for one durable integrated runtime.

## Safe preparatory work completed

M9 adds an RDF graph canonicalizer that preserves all blank-node triples. It performs invariant color refinement and exhaustively searches unresolved blank-node permutations, selecting the lexicographically minimal graph serialization. Search is bounded and fails closed rather than discarding triples. It currently canonicalizes one RDF graph (N-Triples), not an RDF Dataset with named-graph identity.

A fixed local Compose physical-generation driver now derives only `gen-a`/`gen-b` projects, ports, volumes, and endpoints for allowlisted backends. It provides structured create/start/restart/stop/retire/delete operations and rejects caller-selected resource names and non-Docker-Desktop contexts.

The Query Router now has a real process entry point and strict local configuration. It reads the PostgreSQL serving pointer for each request through the existing repository. This preparatory runtime was not represented as M9 qualification evidence because the contradictions above prevent a correct candidate dataset.

## Skipped qualification work

Because the consistency gate failed, the following were intentionally not run:

- real C0→C1 RecentChanges candidate replay;
- generation-scoped revision-fence proof;
- canonical equality against the integrated candidate;
- post-promotion incremental synchronization;
- A–M physical crash matrix;
- PostgreSQL outage and serving-backend outage suites;
- integrated retirement/cleanup;
- Virtuoso 30-minute soak (actual duration: 0 minutes);
- Oxigraph, Fuseki, and cross-backend integrated qualification.

Running these before resolving the dataset/fence/schema contracts could create false positive evidence.

## Required contract correction before qualification resumes

1. Add generation-scoped cursor and entity fences, keyed by `(source_identity, generation_id, entity_id)`, while retaining the source ingestion cursor separately.
2. Define one backend-neutral physical dataset projection. Bootstrap must partition the snapshot into the same entity/property/global graph layout used by incremental writes; no stale duplicate default graph may remain.
3. Define the logical query dataset explicitly. Each adapter must expose the same union semantics without accepting client-controlled graph/service URLs.
4. Define Property schema materialization, preferably deterministic per-Property schema graphs plus a bounded global static graph, so one Property edit can be replaced independently and `GLOBAL_SCHEMA_STALE` can be cleared by evidence.
5. Bind worker execution to a generation-scoped repository and backend descriptor supplied by the structured coordinator.
6. Extend canonicalization from RDF graph to RDF Dataset canonicalization when named-graph identity is part of equality.

These are correctness repairs, not optional test-harness changes. They require an ADR and migration before the M9 qualification can resume.

## Classification and backend roles

Virtuoso, Oxigraph, and Fuseki/TDB2 are each `INSUFFICIENT_EVIDENCE`. Overall architecture is `INSUFFICIENT_EVIDENCE`. Virtuoso remains only the default candidate, Fuseki the reference candidate, and Oxigraph the lightweight candidate. `DEFAULT_BACKEND` remains unset.

## Recommended next scope

The next milestone should be a narrowly scoped “M9A generation-scoped dataset contract repair”: ADR, PostgreSQL migration, snapshot partition loader, per-Property schema partition, adapter-level logical union query contract, generation-scoped worker repository, and RDF Dataset canonicalization. After those pass deterministic tests, resume M9B with the requested real replay, outage/crash matrix, 30-minute Virtuoso soak, and secondary backend runs.
