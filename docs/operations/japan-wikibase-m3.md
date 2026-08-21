# Japan Wikibase M3 incremental RDF semantics

## Outcome

M3 is classified **`SAFE_WITH_PARTITIONING`**, not unrestricted entity replacement. The controlled experiment demonstrates a portable entity-graph model, but does not approve a production synchronizer.

The safe experimental partition is:

- one named graph `urn:jwb:entity:{entityId}` loaded from the complete upstream EntityData RDF;
- one separately rebuilt global/property-schema partition;
- full snapshot reset/rebuild as mandatory recovery;
- revision fencing before every future update.

Deleting triples by value URI, reference URI, or subject prefix in a flat graph is unsafe.

## Dataset and baseline

The fresh M1 database generated P1–P7 and Q1–Q3. Q2 and Q3 each contained the same string, external ID, Q1 Item target, quantity 42, time 2026-08-19, qualifier, and reference. Q2 also had a deletable second statement. Both Items had Japanese/English labels, descriptions, and aliases. Actual identifiers and statement hashes are in `artifacts/jwb-m3/entity-manifest.json`; it contains no credentials.

The canonical baseline contained 407 triples and 52,787 bytes and took 230 ms to generate. Canonicalization sorts RDF sets, decodes equivalent Unicode escapes, and normalizes equivalent `xsd:decimal` lexical forms. It does not alter IRIs, predicates, language tags, datatypes, or graph membership.

## Mutation findings

| Case | Revision | Dynamic added/removed | Principal RDF effect |
|---|---:|---:|---|
| A Japanese label | 12 | 4 / 4 | label, prefLabel/name and entity metadata changed |
| B English description | 13 | 2 / 2 | one description and revision metadata changed |
| C alias add | 14 | 3 / 2 | altLabel added |
| C alias remove | 15 | 1 / 2 | altLabel removed |
| D string value | 16 | 3 / 3 | direct and statement literal replaced; statement URI stable |
| E Item target | 17 | 3 / 3 | direct and statement object changed; target entity RDF not embedded |
| F statement deletion | 18 | 3 / 9 | statement-local triples and direct claim removed |
| G qualifier change | 19 | 2 / 2 | qualifier literal replaced on the same statement |
| G qualifier delete | 20 | 1 / 2 | qualifier triple removed |
| H reference change | 21 | 4 / 2 | statement link changed and a new hashed reference node appeared |
| H reference delete | 22 | 2 / 5 | statement link and now-unowned reference triples removed from Q2 output |
| I quantity | 23 | 7 / 4 | direct/statement values changed and a new hashed value node appeared |
| J time | 24 | 9 / 4 | direct/statement values changed and a new hashed time node appeared |
| K external ID | 25 | 3 / 3 | direct and statement literals changed |

Exact added and removed triples are stored as `diff-*.added.nt` and `diff-*.removed.nt`. Revision metadata accounts for some generic additions/removals in every case.

## EntityData versus full dump

EntityData contained the entity, statement nodes, qualifier triples, reference nodes, value nodes, terms, and referenced Property ontology/schema definitions. It did not recursively include the target Item's entity description. Compared with the dynamic closure in the full dump, EntityData was a strict superset: Q2 had 177, Q3 had 235, and Q1 had 2 additional serialization/schema triples. These extras are why global/static data must be partitioned explicitly rather than treating an entity response as a minimal independent graph.

## Node ownership and shared-node proof

| Node | Evidence-based classification |
|---|---|
| Item/Property entity URI | entity identity; may be referenced globally |
| statement URI | entity/statement-local; Q2 and Q3 never shared one |
| quantity/time value URI | content-addressed and shared across entities |
| normalized value URI | content-derived; do not assume entity ownership |
| reference URI | reference-content-addressed and shared across entities |
| blank node | serialization/graph local only; identity cannot cross parses |
| Wikibase ontology/property schema | global/static partition |

Q2 and Q3 shared exactly two value subjects (`quantity 42` and the identical time) and one reference subject. They did not share statement subjects. Equal external identifiers remained literals; the equal Item target was the same entity object URI. URI shape alone was not used to infer these results.

## Named-graph experiment

Baseline EntityData was loaded into three entity graphs, then only the mutated Q2 graph was replaced. The union was compared to the final fresh full dump's dynamic entity closure. Unicode, decimal lexical variants, whitespace, and duplicate RDF set members were normalized; `schema:softwareVersion`, license, and separately classified global/property-schema triples were explicitly ignored.

| Backend | Dynamic full-only | Dynamic union-only | Equal | Rebuild |
|---|---:|---:|---:|---:|
| Fuseki/TDB2 | 0 | 0 | yes | 65 ms |
| Virtuoso | 0 | 0 | yes | 12 ms |
| Oxigraph | 0 | 0 | yes | 6 ms |

Backend results are semantically identical. Fuseki serialized integer decimals with `.0`, Virtuoso used tabs and graph-local blank-node identities, and Oxigraph preserved compact decimal forms; these were representation differences, not RDF graph differences.

## Alternative models

| Model | Correctness and trade-off |
|---|---|
| A Full snapshot rebuild | strongest recovery baseline; portable/idempotent, but expensive and has snapshot/cursor race |
| B Delete/insert by entity subject | unsafe: misses statement/value/reference subjects and can delete shared nodes if widened |
| C Statement-scoped replacement | insufficient for terms, entity metadata and shared value/reference garbage collection |
| D Entity graph + global/shared partition | demonstrated for dynamic RDF; portable, but global schema and lifecycle events require explicit handling |
| E Revision graphs + compaction | audit-friendly and failure tolerant, but storage/query complexity grows without bounded compaction |
| F WDQS-style event updater | mature compatibility direction for Blazegraph; product-specific machinery and gap/rebuild operations remain |

M4 should continue Model D with Model A recovery. Revision graphs may be used temporarily for atomic staging, not as an unbounded public dataset.

## RecentChanges and fencing

All 14 mutations appeared as `type=edit` records titled `Item:Q2` with `rcid`, `revid`, `old_revid`, and timestamp. Statement deletion is an Item edit, not an entity-deletion log event. Entity deletion, redirect, and merge were not exercised, so their complete event payload remains unproven and is an M4 gate.

The minimum cursor is `(recentChangesTimestamp, rcid)` plus source wiki identity. Each entity registry row needs `indexedRevision`, last event cursor, graph checksum, and status. Apply only when `indexedRevision < incomingRevision`:

- duplicate or older event: acknowledge without write;
- direct next revision: fetch RDF for that exact/current revision policy, stage, replace, then commit fence;
- gap: stop that entity, replay available changes or trigger snapshot recovery;
- deletion: remove only that entity graph after a verified lifecycle event;
- redirect/merge: fetch canonical redirect RDF and affected entities; never infer from title alone;
- failed write: do not advance the fence; retry idempotently, then rebuild on ambiguous partial state.

## Snapshot race

The inspected `dumpRdf.php` constructs an SQL entity pager, prefetcher, and revision lookup. It exposes batching/sharding positions but no snapshot revision or transaction/cursor guarantee. M3 paused edits, so its snapshots are consistent by experiment control only.

A future rebuild must capture a RecentChanges cursor before the dump, build into a staging dataset while retaining events, capture an end cursor, replay all changes after the start cursor with revision fencing, verify no gap, and then atomically switch the served dataset. The interval between start cursor and each entity read is the race window; an end timestamp alone does not close it.

## Backend implication

Evidence remains insufficient to select a production default. Provisionally:

- **reference backend:** Fuseki/TDB2 for standards-portable behavior and clear Graph Store semantics;
- **lightweight candidate:** Oxigraph, whose M2 footprint and M3 behavior are attractive but whose operational maturity still needs scale testing;
- **operational candidate:** Virtuoso, correct in M3 but requiring Digest mutation access, a managed dataset graph, and careful blank-node/schema handling.

Blazegraph/WDQS can use its existing event updater rather than assuming this generic Graph Store algorithm; M3's ownership evidence still applies to its Wikibase RDF. QLever requires proof of efficient graph replacement/update-delta compaction and may remain better suited to aggregated/federated querying.

## Exact M4 scope

1. Implement a bounded RecentChanges reader with `(timestamp, rcid)` cursor persistence and allowlisted local endpoint.
2. Add entity lifecycle fixtures for deletion, undelete, redirect, redirect removal, and supported merge behavior.
3. Implement a registry-only revision fence state machine with duplicate, out-of-order, gap, retry, and poison-event tests.
4. Add an entity RDF fetcher that validates Q/P IDs, response size/type, canonical entity identity, and revision policy.
5. Add staging-graph replacement and crash-point tests; prove or reject atomic visibility per backend.
6. Maintain a separately versioned global/property-schema graph.
7. Implement automatic gap escalation to a staging full rebuild and cursor catch-up; never mutate the serving dataset in place during rebuild.
8. Add bounded retention/compaction and checksums, metrics, and reconciliation without building a production queue or Controller UI yet.
9. Re-run the same correctness suite on the AMD64 Blazegraph compatibility path before enabling a generic adapter there.

Production synchronization remains disabled until every lifecycle, cursor-gap, atomicity, and rebuild cutover gate passes.
