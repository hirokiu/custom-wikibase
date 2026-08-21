# ADR-0020: Pluggable RDF backends expose capabilities through a stable contract

Status: Accepted

Wikibase RDF is derived from canonical MediaWiki/Wikibase entities and is synchronized through a backend-neutral `RdfBackend` contract. Backend selection is a validated instance profile and capability decision. The initial serious compatibility targets are Virtuoso, Apache Jena Fuseki/TDB2, and Blazegraph/WDQS. Oxigraph is a lightweight evaluation target. QLever is evaluated both per instance and as a federation or aggregate query backend. Listing a backend family does not claim that its adapter is implemented or production-ready.

The Controller models standard query, update, named-graph, transaction, Graph Store Protocol, federation, full-text, geospatial, and Wikibase label-service capabilities explicitly. It must not infer capabilities from a product name and must not depend on Blazegraph URLs, namespaces, APIs, query hints, or `SERVICE wikibase:label`. Backend-specific extensions are optional capabilities and cannot replace standard Wikibase RDF semantics.

RDF extraction and change detection are owned by the synchronization layer. An adapter receives validated snapshot, entity revision, graph IRI, and export requests; it does not fetch arbitrary URLs or accept shell fragments. Public query access and internal mutation access are separate endpoint descriptors. Mutation endpoints must not be exposed to browsers or untrusted networks.

An instance may change backend type when an adapter supports export or canonical snapshot rebuild and the Controller can verify freshness before cutover. Migration never changes local entity identifiers or makes the derived store authoritative. Reset is destructive to derived data only, requires an explicit confirmation token at the service boundary, and cannot remove MediaWiki, MariaDB, or upload data.
