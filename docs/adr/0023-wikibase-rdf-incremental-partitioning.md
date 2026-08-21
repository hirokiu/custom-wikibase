# ADR-0023: Wikibase RDF incremental updates require graph partitioning

- Status: Accepted for M4 experimentation; not production approval
- Date: 2026-08-19

## Decision

Classify M3 as `SAFE_WITH_PARTITIONING`. An entity update may replace a graph keyed by a validated entity ID only when that graph is generated from the complete upstream `Special:EntityData/{id}` representation. Global ontology/property schema data is managed separately. A flat dataset cannot safely delete triples by shared value or reference subject.

Equivalent quantity and time values produced identical value URIs across two Items. Identical reference snaks produced an identical reference URI. The entity graphs each contained the shared node triples, so replacing one graph preserved the other graph's copy. Dynamic graph union equalled a fresh full dump on Fuseki/TDB2, Virtuoso, and Oxigraph after RDF lexical normalization and explicit exclusion of serialization/global metadata.

Production synchronization remains unapproved until M4 proves lifecycle events, revision fencing, gap recovery, and failure atomicity. Full snapshot reset/rebuild is mandatory recovery.

## Consequences

- Never implement delete-by-value-URI, delete-by-reference-URI, or broad subject-prefix deletion in a flat graph.
- Store `indexedRevision` per entity and accept only a strictly newer revision.
- Keep entity graphs, global schema, and snapshot provenance distinct.
- Treat duplicate shared triples in separate named graphs as intentional ownership, not waste to deduplicate across graph boundaries.
