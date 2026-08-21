# ADR-0022: RDF backend conformance boundary

- Status: Accepted
- Date: 2026-08-19

## Decision

Use one backend-neutral conformance suite driven by the `RdfBackend` contract and a canonical Wikibase `dumpRdf.php` snapshot. Backend profiles declare observed capabilities; an operation whose capability is false fails closed. Queries use portable SPARQL only.

Public query and internal mutation endpoints are distinct security descriptors. Graph Store and SPARQL Update are never public APIs. Local loopback exposure is allowed only for the disposable M2 harness.

Treat snapshot replacement/rebuild as the safe baseline. Named-graph replacement is an experiment and is not production-ready entity synchronization because Wikibase RDF contains shared statement value and reference structures.

Virtuoso, Fuseki/TDB2, and Blazegraph/WDQS remain primary compatibility targets. Oxigraph is a lightweight evaluation target. QLever remains a research/contract target until measured separately as a per-instance and aggregate backend.

## Consequences

M1 Core retains no RDF runtime dependency. A backend can be selected without changing Controller domain logic. Backend-specific features such as label services and full-text search stay optional and cannot leak into common queries.
