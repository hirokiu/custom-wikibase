# Development and troubleshooting

必要条件はNode.js 20+、Apple Silicon Docker Desktop、Docker context `desktop-linux`です。`jwb:create`が`JWB_BACKEND_ARGUMENT_REQUIRED`なら`--backend=none|virtuoso|fuseki-tdb2|oxigraph`を明示してください。既存stateがある場合は誤上書きを避けて停止します。

```sh
npm run jwb:release:qualify
npm run check
npm run jwb:db:test
PATH=/private/tmp/wfp-helm-4.2.2:$PATH npm run helm:check
```

release qualificationは固定順で4 profileを作成・検証・削除します。`wfp-jwb-m1`は対象外で変更しません。失敗時は`artifacts/jwb-release/qualification.json`のerrorとcleanupを確認してください。production、utirik、Kubernetes、Controller、Wikidata、GitHub Actionsは使用しません。

SBOMはrepository-local `npm/cli-10.8.2`でSPDX 2.3 JSONとして生成します。J2-G baselineは11個のJWB workspace、96 packages、120 relationshipsです。成果物は`artifacts/jwb-release/sbom.spdx.json`です。
