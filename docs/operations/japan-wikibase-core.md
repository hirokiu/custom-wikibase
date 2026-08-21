# Japan Wikibase Core ローカル製品ランタイム

Japan Wikibase Core は、MediaWiki、Wikibase Repository、MariaDB、Job Runner だけで動作する `backend=none` プロファイルです。Controller、PostgreSQL、RDF同期、SPARQLバックエンドは必要としません。

## 必要条件

- Apple Silicon Mac
- Docker Desktop（Linux containers、`desktop-linux` context）
- Node.js 20 以上

このライフサイクルは固定Compose project `japan-wikibase` だけを対象にします。k3s、k3d、本番環境、既存の `wfp-jwb-m1` は対象外です。

## 利用方法

```sh
npm run jwb:create -- --backend=none
npm run jwb:status
npm run jwb:test
npm run jwb:stop
npm run jwb:start
npm run jwb:destroy
```

Web UI は <http://127.0.0.1:8280/>、Action API は <http://127.0.0.1:8280/api.php>、ランタイム情報は <http://127.0.0.1:8280/.well-known/japan-wikibase-runtime> です。通常の利用ではホストに公開されるのはこのHTTPポートだけで、MariaDBは公開されません。

初回作成時に管理者資格情報とstable instance UUIDを生成します。資格情報を含むruntime stateは `/private/tmp/japan-wikibase-runtime.json` にモード `0600` で保存され、profile state `/private/tmp/japan-wikibase-profile.json` とは分離されます。これらをコミット、共有、ログ出力しないでください。

## 永続性とライフサイクル

`stop` は3サービスを停止するだけで、MariaDB、uploads、runtime-stateのnamed volumeとinstance UUIDを保持します。`start` は同じデータを使って再開します。

`destroy` は破壊的です。固定project、`backend=none`、Docker Desktop ARM64というガードを通過した場合に限り、`japan-wikibase` のコンテナ、network、named volume、ローカルstateを削除します。削除後のデータは復旧できません。M1や他のCompose projectは削除しません。

## 状態確認とトラブルシューティング

`jwb:status` は資格情報を含まないJSONを返し、MediaWiki、Action API、MariaDB、Wikibase、Job Runner、runtime contract、query無効状態を示します。`jwb:test` は実際のAPIログイン、テストItem、生成PNGのupload/read-back、SHA-256、`jwb-runtime-v1`を検証します。

- `unsafe Docker target` の場合はDocker Desktopを起動し、contextとarchitectureを確認してください。他contextへの切替による回避はしないでください。
- `product state already exists` の場合は `jwb:status` で既存製品を確認してください。stateファイルだけを手動削除しないでください。
- health待機が失敗した場合は `docker compose --project-name japan-wikibase --file infrastructure/japan-wikibase/compose.product.yaml ps` で安全な状態だけを確認し、資格情報や環境変数を出力しないでください。
- SPARQLが必要な場合、これはCore-onlyプロファイルの範囲外です。J2-Bではquery subsystemを起動しません。
