# Japan Wikibase M9A generation-scoped contract repair

## Outcome

The four M9 blockers are repaired locally. The M9A contract classification is **READY_FOR_M9B_QUALIFICATION**; this is not backend qualification and `DEFAULT_BACKEND` remains unset. No M9 replay, crash/outage matrix, soak, Controller integration, GitHub Actions, Wikidata publication, production operation, or utirik connection was performed.

## Repaired contract

All bootstrap, rebuild, incremental, export, and equality paths use `jwb-partition-v1`:

| Partition | Graph | Ownership |
|---|---|---|
| Entity | `urn:jwb:entity:<ID>` | entity root plus statement/value/reference closure |
| Property schema | `urn:jwb:schema:<P-ID>` | schema nodes reached from the Property root plus blank-node closure |
| Global static | `urn:jwb:global` | canonical triples not assigned above |

The physical default graph is empty and non-authoritative. Snapshot loading resets the target and loads only named graphs. The durable per-generation graph registry supplies a fixed graph list to Query Router, which presents their union through repeated SPARQL Protocol `default-graph-uri` parameters. Client graph names are neither required nor accepted as routing configuration.

The controlled M3 dataset proves that full-snapshot partitioning equals entity-by-entity, Property-schema, and global materialization as an RDF Dataset. The dataset contains 18 partitions. The same exported Dataset was then verified against real local stores:

| Backend | Named graphs | Default graph | Logical union | Dataset diff |
|---|---:|---|---|---|
| Virtuoso | 18 | empty | visible | 0 / 0 |
| Fuseki/TDB2 | 18 | empty | visible | 0 / 0 |
| Oxigraph | 18 | empty | visible | 0 / 0 |

The comparator retains named-graph identity and all blank-node triples. It performs bounded blank-node isomorphism search and fails closed at the configured limit. Backend serialization differences for Unicode escapes, whitespace, and equivalent `xsd:decimal` lexical forms are normalized. It is intentionally limited to N-Quads with IRI graph names.

## Durable synchronization model

Migration `008_generation_scoped_sync.sql` adds:

- a distinct source ingestion cursor;
- `rdf_generation_sync`, keyed by source and generation, with snapshot/catch-up cursors and schema state;
- `rdf_generation_entity_revision`, keyed by source, generation, and entity;
- `rdf_generation_graph`, the exact logical-union membership registry.

Serving A and candidate B therefore have independent cursors and revision fences. PostgreSQL integration tests prove independent advancement and prohibit generation deletion while dependent rows remain. Existing unequivocally empty state is marked `EMPTY_CONFIRMED`; any legacy row with cursor/entity/rebuild evidence stays `UNREVIEWED`, and ingestion access fails closed with `LEGACY_SYNC_STATE_AMBIGUOUS`. No existing row is silently reinterpreted.

Property events replace the entity graph and its deterministic schema graph, register both, and only then set schema state to `CURRENT`. Property deletion removes both graphs and registrations. `markCurrent()` rejects a generation whose schema is not current, closing the former `GLOBAL_SCHEMA_STALE` dead end.

The worker now requires a structured, validated generation descriptor and binds its repository and physical backend to that generation. Only `gen-a`/`gen-b`, known backend types, local internal endpoints, and `jwb-partition-v1` are accepted by the local runtime. It does not construct or execute arbitrary `kubectl`, shell, or backend administration commands.

## Commands and evidence boundary

The focused physical contract is repeatable with:

```sh
npm run jwb:dataset:contract -- --backend=virtuoso
npm run jwb:dataset:contract -- --backend=fuseki-tdb2
npm run jwb:dataset:contract -- --backend=oxigraph
```

Each command has Docker Desktop/local-context guards and deletes only its fixed disposable generation. These runs establish M9A contract compatibility, not end-to-end rebuild qualification.

## M9B entry conditions

M9B may resume real C0→C1 replay, post-promotion synchronization, failure matrix, retirement, and the requested soak using this contract. Qualification must still fail closed on a non-current schema, cursor/fence inconsistency, graph-registry mismatch, canonical Dataset difference, unsafe Router target, or ambiguous legacy state.
