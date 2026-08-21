# Custom Wikibase 0.1.0-rc.1

Custom Wikibaseは、MediaWiki 1.43とWikibaseを基盤に、日本語、`Asia/Tokyo`、UTF-8を既定にしたローカルStandalone Wikibaseディストリビューションです。MediaWiki/Wikibaseが唯一の正本であり、RDF/SPARQL query subsystemは任意です。

これはApple Silicon Docker Desktop向けのlocal standalone release candidateです。production readinessを意味しません。Federated PlatformやControllerは実行に不要です。製品リポジトリは <https://github.com/hirokiu/custom-wikibase> です。

## Quickstart

backendは必ず明示します。引数なしの`jwb:create`は安全のため失敗します。

```sh
# Core-only
npm run jwb:create -- --backend=none
npm run jwb:status
npm run jwb:test
npm run jwb:destroy

# v0.1既定query profile
npm run jwb:create -- --backend=virtuoso
npm run jwb:status
npm run jwb:destroy

# Reference / Lightweight
npm run jwb:create -- --backend=fuseki-tdb2
npm run jwb:destroy
npm run jwb:create -- --backend=oxigraph
npm run jwb:destroy
```

共通操作は`jwb:status`、`jwb:test`、`jwb:stop`、`jwb:start`、`jwb:destroy`です。query profileでは`jwb:rebuild`、`jwb:promote`、`jwb:rollback`も利用できます。任意のCompose project、ファイル、URL、SQL、shell断片、generation IDは受け付けません。

`stop`はvolumeを保持し、`start`で同じinstance ID、MariaDB、uploads、query control data、RDF storesを再利用します。`destroy`は固定project `japan-wikibase`のコンテナ、network、volume、ローカル一時credentialを削除する破壊操作です。

## 固定された製品semantics

- MediaWiki/Wikibaseがsource of truth
- canonical public URLはRDF identityの一部
- RDF normalizationは`jwb-rdf-normalization-v1`
- partition modelは`jwb-partition-v1`
- 公開SPARQLはlogical Query Router endpointのみ
- backendとA/B generationは内部実装
- backendは交換可能
- automatic physical generation deletionは無効
- rollback generationを保持

作成後のcanonical hostname変更はv0.1では未対応です。reverse proxy設定だけの変更ではなく、明示的なRDF identity migration設計が必要です。

## 文書

- [Architecture](architecture.md)
- [Backend guide](backends.md)
- [Runtime contract](runtime-contract.md)
- [Security and data ownership](security.md)
- [Development and troubleshooting](development.md)
- [Known limitations](known-limitations.md)
- [Release notes](release-notes-0.1.0-rc.1.md)
- [Qualification evidence](qualification.md)
- [License and NOTICE review](third-party-notices.md)
- [Licensing policy](licensing.md)
