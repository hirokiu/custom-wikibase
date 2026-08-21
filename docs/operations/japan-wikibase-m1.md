# Japan Wikibase M1 local environment

M1 is a disposable, native Apple Silicon Docker Desktop environment. It contains MediaWiki 1.43.9, Wikibase Repository at the pinned `REL1_43` commit, a separate Job Runner, and MariaDB 10.11. MediaWiki, Composer, and MariaDB base images use multi-platform digest pins, and the resolved Wikibase PHP dependencies are committed in `infrastructure/japan-wikibase/composer.lock`. It deliberately contains no RDF or SPARQL backend.

```sh
npm run jwb:create
npm run jwb:test
npm run jwb:stop
npm run jwb:start
npm run jwb:test
npm run jwb:destroy
```

The wiki is available only at `http://127.0.0.1:8180`. Runtime credentials are generated into `/private/tmp/wfp-jwb-m1-state.json` with mode `0600`; no `.env` file is created. `jwb:destroy` is fixed to Docker Desktop context `desktop-linux`, Compose project `wfp-jwb-m1`, and its labelled disposable volumes. It refuses non-ARM64 and non-local Docker targets.

`jwb:test` verifies native ARM64 images, Japanese MediaWiki configuration, the loaded Wikibase Repository extension, the Wikibase Action API, and a harmless persistent local item. Running it again after stop/start verifies that the item survived container recreation.

This profile is for development only. It does not provide TLS, backups, public ingress, production credentials, RDF indexing, SPARQL, or Wikidata publication.
