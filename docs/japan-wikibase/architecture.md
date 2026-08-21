# Architecture

```text
Browser/API -> MediaWiki + Wikibase -> MariaDB + uploads
                    |
                    +-> source reader -> JWB PostgreSQL -> A/B sync workers
                                                        -> RDF backend A/B
SPARQL client -> logical Query Router -> serving generation
```

Core-onlyにはPostgreSQL、worker、Query Router、RDF backendがありません。query profileではJWB PostgreSQLがcursor、revision fence、generation lifecycle、serving pointerを保持します。Query Routerだけがpublic query interfaceで、backend update/admin endpointはprivate network内です。

Hot rollbackのためA/B両workerを動かし、rollback generationを`CURRENT`に保ちます。現在のDB表現は`state=RETIRING`かつ`protection=ROLLBACK`で、意味は「retained rollback generation」です。高速で安全なrollbackと引き換えにRDF更新コストが重複します。将来候補は`RETAINED_ROLLBACK`状態、warm rollback、snapshot-only rollbackです。J2-Fではenumを変更しません。

### Compatibility baseline

| Component/contract | Version |
|---|---|
| Distribution | 0.1.0-rc.1 |
| MediaWiki | 1.43.9 |
| Wikibase | c79eb4efab9ad27267a6df9034e1b99ad695d1c7 |
| MariaDB | 10.11.14 |
| JWB PostgreSQL | 16.9-bookworm |
| Virtuoso | 7.2.17 |
| Apache Jena/Fuseki | 6.1.0 / Temurin JRE 21 |
| Oxigraph | 0.5.7 |
| Node runtime | 20.19.2 |
| Runtime contract | jwb-runtime-v1 |
| RDF normalization | jwb-rdf-normalization-v1 |
| Partition model | jwb-partition-v1 |

AMD64向けbuild定義とupstream imageは用意されていますが、0.1.0-rc.1のAMD64 runtime qualificationは未実施です。

Database ownership is physically separated at the repository boundary: Platform migrations 001–004 remain in `packages/database`; Japan Wikibase migrations 005–013 and their allowlisted runner live in `packages/jwb-database`. Migration numbers and checksums are unchanged.
