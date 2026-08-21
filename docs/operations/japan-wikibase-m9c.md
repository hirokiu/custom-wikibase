# Japan Wikibase M9C canonical normalization and lifecycle report

## Outcome

M9C classification is **READY_TO_RESUME_M9B**. This repairs the M9B equality blockers only; it does not resume M9B, run its soak/crash matrix, qualify a backend, or set `DEFAULT_BACKEND`.

No production, utirik, Controller, GitHub Actions, DNS, or Wikidata operation occurred.

## Canonical derived RDF definition

Canonical query RDF contains entity identity and terms, statements, qualifiers, references, values, Property ontology/schema, and stable global schema required for Wikibase queries. Export invocation provenance is not entity state and lives in the Generation Manifest.

`jwb-rdf-normalization-v1` precedes `jwb-partition-v1` for full dump and EntityData paths. Its decisions are structural and explicit:

| Evidence shape | Classification | Treatment |
|---|---|---|
| subject exactly `wikibase:Dump` | full-dump export artifact | `MOVE_TO_GENERATION_MANIFEST` |
| `cc:license` on `Special:EntityData/<ID>` | repeated entity-export provenance | `MOVE_TO_GENERATION_MANIFEST` |
| `schema:softwareVersion` on `Special:EntityData/<ID>` | serializer/software provenance | `MOVE_TO_GENERATION_MANIFEST` |
| other supported RDF | canonical semantic RDF | `KEEP` |
| unknown predicate on `wikibase:Dump` | unclassified export structure | `REJECT_UNKNOWN` |

License is stable legal/export metadata, but is emitted once on the dump artifact and once per EntityData response rather than per logical entity. It is retained once as manifest evidence, not duplicated into entity graphs. `softwareVersion` describes exporter state and follows the same rule. `Dump schema:dateModified` changes between equivalent exports and is recorded as artifact generation provenance, outside user query RDF.

The manifest schema contains generation/source identity, normalization and partition models, source cursor, generated time, exporter/license evidence, MediaWiki/Wikibase versions when observed, Dataset checksum, and validation result. It is persisted as JSONB and not exposed through the logical SPARQL union.

## Difference inventory and reproducibility

Machine-readable evidence is in `artifacts/jwb-m9c/difference-inventory.json`.

| Comparison | Raw difference | Normalized difference |
|---|---:|---:|
| unchanged full dump D1 vs D2 | 1 / 1 | 0 / 0 |
| full dump vs all 11 EntityData responses | 6 / 22 | 0 / 0 |

The D1/D2 difference was solely `Dump schema:dateModified`. The full-dump-only six quads were the dump artifact's two types, license, softwareVersion, dateModified, and ontology import. EntityData-only contained 11 license and 11 softwareVersion copies. No generic predicate filter or equality-time line exclusion was used.

## Lifecycle findings and repair

Real Q4 evidence is in `artifacts/jwb-m9c/lifecycle-evidence.json`:

- delete: log event, `revid=0`, `old_revid=0`, Action API missing, EntityData 404;
- restore: separate log event in the same second, `revid=0`, `old_revid=0`;
- restored entity: original revision 12, EntityData 200 with revision evidence.

The old fence saw revision 12 already indexed and skipped restoration as a duplicate. The repaired model retains a `DELETED` tombstone and permits only a verified `ENTITY_UNDELETE` to enter `RESTORING` and rematerialize that same revision. Normal edit gap rules are unchanged. Repeated delete remains idempotent; repeated restore deterministically rewrites the same graph.

In the real candidate replay, serving A advanced Q3 from revision 36 to 38 while B remained at 36, then B independently replayed to 38. Q4 returned to `CURRENT` at revision 12. Disposable Property P8 returned to `CURRENT` at revision 39 and restored both `urn:jwb:entity:P8` and `urn:jwb:schema:P8`. Generation schema state was `CURRENT`. The resulting 20-graph candidate Dataset difference was 0/0.

## Backend and query regression

The controlled normalized Dataset and common Item, Property, label, statement, qualifier, reference, quantity, time, and Property-schema ASK queries passed on all targets:

| Backend | Graphs | Default graph | Logical union | Dataset diff |
|---|---:|---|---|---:|
| Virtuoso | 18 | empty | correct | 0 / 0 |
| Fuseki/TDB2 | 18 | empty | correct | 0 / 0 |
| Oxigraph | 18 | empty | correct | 0 / 0 |

This is contract evidence, not durable-sync backend qualification.

## Persistence changes

Migration `009_rdf_normalization_manifest.sql` adds `RESTORING`, `normalization_model`, `partition_model`, and `generation_manifest`. Existing rows deliberately retain a NULL normalization model. The serving-pointer repository requires the exact M9C normalization/partition versions and a manifest before promotion, so legacy generations fail closed.

## M9B resume scope

M9B must restart from its first bootstrap and may use only generations built with `jwb-rdf-normalization-v1` plus `jwb-partition-v1`. It must rerun real replay, independent fences, lifecycle operations, final Dataset equality, two-Router promotion, post-promotion sync, rollback freshness, A–M crash/outage matrix, retirement, Virtuoso 30-minute soak, secondary backends, and cross-backend migration. No prior partial M9B evidence counts as qualification.
