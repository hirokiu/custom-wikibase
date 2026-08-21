# License and NOTICE review inventory

This is an engineering inventory, not a legal conclusion.

| Component | Observed license | Review source |
|---|---|---|
| MediaWiki | GPL-2.0-or-later | upstream copyright/license |
| Wikibase | GPL-2.0-or-later | upstream repository |
| Virtuoso Open Source | GPL-2.0-only | upstream LICENSE |
| Apache Jena/Fuseki | Apache-2.0 | Apache project |
| Oxigraph | MIT OR Apache-2.0 | upstream repository |
| MariaDB Server | GPL-2.0-only | MariaDB licensing page |
| PostgreSQL | PostgreSQL License | PostgreSQL project |
| Node.js | MIT | Node.js LICENSE |
| Eclipse Temurin/OpenJDK | GPL-2.0-with-classpath-exception and bundled notices | Adoptium distribution |
| npm production dependencies | package-specific | lockfile/node_modules license audit required |

Custom Wikibase original software code is licensed under **GPL-2.0-or-later** by explicit project-owner decision. The repository-root `LICENSE` records that decision. This does not relicense third-party components. Before publication, human/legal review must still validate dependency redistribution obligations and approve the final NOTICE contents. Full upstream license texts are not duplicated unless the packaging strategy requires them.

Original Custom Wikibase documentation is licensed under **CC BY 4.0**. Upstream-derived documentation retains its upstream license. This does not change the software-code decision.

The standalone SPDX SBOM is generated from this repository's workspace and lockfile. This inventory is not legal advice; final human NOTICE review remains required.
