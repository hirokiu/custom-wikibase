# ADR-0030: RDF synchronization uses one generation-scoped named-graph dataset

Status: accepted

## Context

M9 found three incompatible views of the same derived RDF: snapshots in a default graph, incremental entity data in named graphs, and synchronization fences shared by every physical generation. Property changes also had no operation that could restore schema currency. These contradictions made automatic rebuild qualification unsafe.

## Decision

`jwb-partition-v1` is the authoritative derived-dataset projection. Wikibase remains canonical; this projection is disposable and rebuildable.

- `urn:jwb:entity:<Q-or-P-id>` contains entity-owned dynamic RDF.
- `urn:jwb:schema:<P-id>` contains ontology/schema RDF seeded from the Property entity and closed over its blank nodes.
- `urn:jwb:global` contains the remaining static RDF.

Membership is derived by graph reachability and the M3/M4 partition evidence, not URI shape alone. Snapshot and EntityData paths use the same partitioner. Application-managed RDF is stored only in these named graphs. The physical default graph is empty and non-authoritative; authoritative triples are never duplicated there.

A normal query means the union of every graph recorded for the serving generation. The Router obtains this fixed allowlisted graph set from PostgreSQL and supplies SPARQL Protocol `default-graph-uri` parameters to the selected backend. Clients do not choose graph names, endpoints, or `SERVICE` URLs. This gives Virtuoso, Fuseki/TDB2, and Oxigraph one backend-neutral logical dataset while preserving explicit `GRAPH` queries.

Synchronization state is keyed by source and generation. Each generation owns its snapshot cursor, catch-up cursor, entity revision fences, schema state, and graph registry. Source ingestion progress is separate. Ambiguous legacy cursor state remains `UNREVIEWED` and cannot advance until explicitly resolved. Foreign keys prevent a generation with retained synchronization state from being silently deleted.

A worker receives a validated immutable descriptor containing generation ID, source identity, backend type, internal endpoints, and partition model. It has no arbitrary backend-administration or shell-command surface. Property replacement writes both entity and Property schema graphs before marking schema `CURRENT`; Property deletion removes both. A generation cannot become `CURRENT` while schema state is not `CURRENT`.

Canonical equality is RDF Dataset equality: graph identity is retained, blank-node labels are canonicalized with a bounded fail-closed search, and equivalent Unicode escapes and `xsd:decimal` lexical forms are normalized. Inputs without an IRI graph name are rejected.

## Consequences

Generation A and B can ingest the same revision independently and catch up from different cursors. Snapshot replacement and incremental replacement converge on the same physical layout, and a failed candidate cannot alter the serving generation's fences or query target. The graph registry becomes part of the serving contract and must be changed with graph lifecycle operations.

This ADR repairs the contract only. It does not qualify automatic rebuild, run the M9 crash/outage matrix or soak, select a default backend, or integrate the Controller.
