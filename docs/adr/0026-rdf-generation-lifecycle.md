# ADR-0026: RDF generations require an explicit serving boundary

- Status: Accepted contract; physical backend proof pending
- Date: 2026-08-19

## Decision

Model a complete derived RDF dataset as an `RdfGeneration` with a validated identifier, source snapshot cursor, catch-up cursor, validation result, lifecycle state, and serving flag. Legal states are `CREATING`, `LOADING`, `CATCHING_UP`, `VALIDATING`, `READY`, `SERVING`, `RETIRING`, `RETIRED`, and `FAILED`. PostgreSQL enforces at most one `SERVING` generation per source.

`RdfBackend` now exposes structured generation operations for creation, snapshot load, entity update/delete, isolated query, validation, compare-and-swap promotion, rollback, retirement, deletion, and listing. Capability metadata explicitly declares isolation, atomic cutover, rollback, generation deletion, and generation query. Unsupported methods fail closed.

The existing Fuseki, Virtuoso, and Oxigraph HTTP graph adapters declare all generation capabilities `false`. Named graphs inside one serving dataset are not sufficient proof of isolation or atomic serving cutover. They must not be relabeled as generation-capable until a stable query-routing or physical dataset-switch adapter passes crash and reader-visibility tests.

## Consequences

- The semantic memory reference proves lifecycle, single-serving, stale-pointer rejection, rollback, retirement, and deletion.
- Automatic physical rebuild remains disabled for all current profiles.
- A future adapter must provide a durable serving pointer and isolate readers from candidate generations; `CLEAR`, `DROP/ADD`, and Graph Store overwrite do not satisfy this ADR by assumption.
