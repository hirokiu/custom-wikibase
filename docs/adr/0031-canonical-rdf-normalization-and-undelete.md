# ADR-0031: Canonical RDF is normalized before partitioning and undelete rematerializes tombstones

Status: accepted

## Context

Real M9B replay proved that upstream full dumps and revision-specific EntityData describe the same Wikibase state with different export metadata. Full dumps also embed their execution time. Separately, MediaWiki delete/restore log events use `revid=0` while restore exposes the original entity revision, so the normal monotonic edit fence incorrectly classified restoration as a duplicate.

## Decision

The canonical derived query Dataset contains Wikibase semantic RDF: entities, terms, statements, qualifiers, references, values, Property ontology/schema, and stable non-export global schema. It excludes the upstream export artifact resource and per-EntityData copies of export provenance.

`jwb-rdf-normalization-v1` runs before `jwb-partition-v1` on both full dumps and EntityData. It applies only structural, allowlisted rules:

- every triple whose subject is exactly `http://wikiba.se/ontology#Dump` moves to the Generation Manifest;
- `cc:license` and `schema:softwareVersion` on a `Special:EntityData/<ID>` subject move to the Generation Manifest;
- all other supported N-Triples remain canonical semantic RDF;
- a new predicate on the dump-export subject fails closed until classified.

The RDF Dataset canonicalizer remains policy-free. Normalization chooses the Dataset; canonicalization compares graph identity and RDF semantics.

Generation records persist `normalization_model`, `partition_model`, and a JSON Generation Manifest. The manifest records source cursor, generation time, exporter/license evidence, software versions when available, semantic Dataset checksum, and validation result. Legacy generations with no normalization model are not reinterpreted and cannot be promoted.

An entity deletion retains its indexed revision and changes state to `DELETED`; the row is a durable tombstone. `ENTITY_UNDELETE` resolves the currently restored canonical revision, moves through `RESTORING`, and force-rematerializes the entity graph even when the restored revision equals the tombstone revision. Property restoration also recreates its schema graph. This exception is limited to a verified restore event; normal edits retain strict revision-continuity rules.

## Evidence

With no Wikibase edit, two full dumps differed only in one `Dump schema:dateModified` quad each. Full dump versus all 11 EntityData responses differed by six dump-export quads versus 22 repeated entity-export quads. After normalization both comparisons were 0/0.

Real Q4 delete/restore produced separate log events with `revid=0`, restored the original revision 12, returned EntityData 200, and was rematerialized by candidate B. A disposable Property P8 was likewise restored with both entity and schema graphs. Final candidate Dataset equality was 0/0.

Virtuoso, Fuseki/TDB2, and Oxigraph loaded the same normalized 18-graph controlled Dataset, returned the required common semantic queries, and exported a 0/0 Dataset diff.

## Consequences

Exporter provenance is retained without affecting user SPARQL results or equality. A normalization-model change requires a new generation rebuild. M9B may resume from the beginning, but this ADR does not itself qualify durable synchronization or select a default backend.
