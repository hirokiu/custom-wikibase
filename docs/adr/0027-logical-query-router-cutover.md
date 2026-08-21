# ADR-0027: Physical RDF generations are selected by a logical query router

Status: accepted for local PoC; production integration deferred

## Decision

One physical generation is one independently addressable RDF process and persistent store. Two named graphs in one serving dataset are not isolated generations. Clients use a stable, read-only SPARQL endpoint; a narrowly scoped query router resolves a PostgreSQL serving pointer once at each request boundary and forwards only to a fixed generation allowlist.

Promotion and rollback use a versioned compare-and-swap transaction. The transaction updates the pointer, generation states, and promotion journal together. Therefore readers see either the complete old pointer or complete new pointer, never an intermediate null pointer. Router replicas need no consensus protocol: each reads the same committed PostgreSQL row at its next request.

The atomic cutover guarantee belongs to the logical query service. Fuseki, Virtuoso, and Oxigraph product capability records continue to report generation/cutover capabilities as false because their existing adapters still address one dataset and do not create physical runtimes.

## Security

The router accepts only SPARQL query forms, rejects updates and `SERVICE`, bounds request/response sizes, applies a timeout, sanitizes errors, forwards no client credentials, and selects only pre-registered local targets. It is not a generic reverse proxy and exposes no load, update, or administration endpoint.

## Consequences

The old process and volume remain available for rollback. Retirement and deletion require separate policy and must reject the serving, rollback-protected, or ambiguous-journal generation. The local M7 harness owns fixed, disposable Compose projects; it is not a production lifecycle driver.
