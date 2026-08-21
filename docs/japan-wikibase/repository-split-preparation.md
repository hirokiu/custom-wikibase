# Repository split preparation scope

Do not split or create a remote repository yet. The next preparation checkpoint is deliberately mechanical:

1. Complete human/legal review of the GPL-2.0-or-later decision and NOTICE inventory; decide the separate documentation license.
2. Review and approve the deterministic commit groups in `commit-plan.md` and the exact extraction manifest.
3. Commit the approved groups without combining unrelated Platform work from shared monorepo files.
4. Place the reviewed extraction set under the approved single prefix `components/japan-wikibase/` in a later boundary-only commit.
5. Re-run J2-F, secret scan, dependency audit, `npm run check`, DB tests, and monorepo Helm regression from the committed checkpoint.
6. Verify local history/subtree extraction and standalone build without creating or pushing a remote.

J2-G physically separated `packages/jwb-database` and `packages/rdf-domain`, repaired workspace/lockfile metadata, and generated the SPDX SBOM. The extraction set comprises JWB apps, RDF packages/services, migrations 005–013, runtime contract, Standalone Compose/Docker assets, `jwb-*` product scripts, maintained docs, ADRs, and selected qualification summaries. Controller, Registry, Provisioner, Platform migrations 001–004, Helm/Kubernetes experiments, server scripts, and M1–M10 raw history are excluded or retained only as explicitly classified history.
