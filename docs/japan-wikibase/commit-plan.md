# Proposed commit plan

No commit is performed by J2-G. Exact membership is the `commitGroup` field in `artifacts/jwb-release/extraction-manifest.json`; each path occurs in at most one group.

| Order | Group | Suggested commit message | Purpose / dependency |
|---:|---|---|---|
| 0 | `00-shared-monorepo-metadata` | `chore(monorepo): register Japan Wikibase workspaces and ownership` | Shared root package/lock/ownership metadata; review with Platform maintainers |
| 1 | `01-architecture-runtime-contract` | `docs(jwb): record standalone product and RDF contracts` | ADRs, runtime contract, normalization and ownership rules |
| 2 | `02-core-standalone-product` | `feat(jwb): add standalone MediaWiki Wikibase core` | Core image, MediaWiki configuration, MariaDB and uploads; depends on group 0 |
| 3 | `03-rdf-sync-query-subsystem` | `feat(jwb): add durable RDF sync and query router` | JWB PostgreSQL runtime, source reader, workers, Query Router and RDF domain; depends on groups 0–1 |
| 4 | `04-rdf-backend-adapters-profiles` | `feat(jwb): add qualified RDF backend profiles` | Virtuoso, Fuseki/TDB2, Oxigraph adapters and fixed Compose profiles; depends on group 3 |
| 5 | `05-generation-lifecycle-tooling` | `feat(jwb): add generation rebuild and cutover tooling` | migrations 005–013 and bounded lifecycle commands; depends on groups 1 and 3–4 |
| 6 | `06-qualification-test-infrastructure` | `test(jwb): add lifecycle and release qualification` | Unit, integration, historical qualification runners and local safety tests; depends on groups 2–5 |
| 7 | `07-release-documentation` | `docs(jwb): add standalone operator documentation` | Maintained README, quickstart, security, limitations and release notes |
| 8 | `08-license-attribution-release-metadata` | `chore(jwb): add GPL license and RC evidence metadata` | Software license, third-party inventory, SBOM, concise evidence and extraction manifest |

Generated RDF captures and full qualification JSON are deliberately excluded. Review and stage one group at a time from the manifest; do not use a blanket `git add .`.
