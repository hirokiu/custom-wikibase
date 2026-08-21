# J2-C1a-2 bounded semantic rebuild qualification

The standalone Virtuoso product path is qualified with a bounded Wikibase
fixture. MediaWiki/Wikibase remains canonical; tests do not inject RDF into a
backend. The fixture uses Q2 as the Item target, Q3 as the subject, and P2–P8
for string, external ID, Item, quantity, time, qualifier, and reference values.
It also covers Japanese/English terms and a Property-label schema mutation.

`npm run jwb:fixture` creates or reuses the safe, secret-free manifest.
`npm run jwb:fixture:test` checks the Action API and the serving logical SPARQL
endpoint. `JWB_REBUILD_RACE_TEST=true npm run jwb:rebuild` performs the bounded
C0/dump/edit/C1/catch-up/validation sequence without promotion. Candidate-only
restart commands are fixed to the non-serving A/B slot:

- `npm run jwb:candidate:restart-worker`
- `npm run jwb:candidate:restart-backend`
- `npm run jwb:candidate:validate`

The observed fixture produced 20 defined partitions: 11 entity graphs, 8
Property-schema graphs, and the defined global partition (empty after canonical
dump-provenance removal). An empty global partition is not materialized as an
authoritative Virtuoso graph. The logical query dataset is derived only from the
validated generation graph registry; backend default graph state is not used.

The deterministic race reached candidate `CURRENT`, schema `CURRENT`,
`READY/VALID`, and canonical equality `missing=0, extra=0`, while gen-a remained
serving. Candidate worker and candidate Virtuoso recreation both retained
generation state and revalidated at 0/0. Promotion, delete/undelete, Fuseki,
Oxigraph, k3d, production, and publication remain out of scope.

Canonical public URL is RDF identity, not merely presentation configuration.
Every product RDF producer must receive the same `JWB_PUBLIC_URL`; mismatches
must fail qualification and must never be normalized after RDF generation.
