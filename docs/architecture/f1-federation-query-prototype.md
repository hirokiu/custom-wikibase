# F1 federation query prototype

Federation is a separate read-only query plane. It must not merge MediaWiki
databases, reuse instance credentials, write to RDF backends, or replace each
Wikibase as the canonical source of truth.

The first prototype should use a static, allowlisted catalog of logical query
services discovered from the Controller Registry. The catalog entry contains a
stable instance UUID, backend capabilities, logical query endpoint, health,
freshness, and an explicit `federationEnabled` flag. Raw user-provided SPARQL
`SERVICE` URLs are forbidden. The planner may target only catalog entries and
must apply request timeouts, response-size limits, concurrency limits, and a
read-only SPARQL validator.

F1 should begin with two K2-style instances whose entity IRIs remain distinct.
Test queries should demonstrate cross-instance result union and a join through
an explicit mapping predicate. Matching local Q/P identifiers by lexical ID is
invalid: `Q1` in one instance has no implied relationship to `Q1` in another.
Mappings need provenance, author, status, and human approval. Federation output
must report contributing instances and per-source freshness.

QLever can be evaluated later as an aggregated serving backend, but the F1
contract should not depend on it. A simple bounded orchestrator over logical
endpoints is sufficient to validate catalog routing, partial-failure policy,
timeout behavior, and provenance. Publication to Wikidata remains outside this
boundary.
