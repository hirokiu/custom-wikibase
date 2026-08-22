# Runtime discovery contract

`GET /.well-known/japan-wikibase-runtime`は公開可能なread-only discovery documentを返します。

Core-only例:

```json
{"contractVersion":"jwb-runtime-v1","distribution":{"type":"japan-wikibase","version":"0.1.0-rc.1"},"instance":{"id":"<uuid>"},"endpoints":{"mediawiki":"http://127.0.0.1:8280/wiki/","actionApi":"http://127.0.0.1:8280/api.php"},"health":{"state":"healthy"},"queryService":{"enabled":false},"capabilities":{"queryOptional":true,"instanceStopPreservesData":true}}
```

Query有効時は`queryService`に`backendType`、logical `logicalEndpoint`、`syncState`、freshness、`servingGeneration`が加わります。`contractVersion`、distribution version、normalization version、partition versionは別々にversioningします。

`freshness`は`cursorTimestamp`、`sourceHeadTimestamp`、`lagSeconds`、`syncLagSeconds`、`sourceIdleSeconds`を持ちます。`lagSeconds`は互換フィールドであり、常に`syncLagSeconds`と同じ値です。timestampと`sourceIdleSeconds`はsource/cursorがまだ存在しない場合に`null`になり得ます。

2026-08-23のSchema修復では、既に実装・公開・qualification済みだった上記フィールドをcanonical JSON Schemaへ反映しました。runtimeの意味やwire representationは変更していないため、contract versionは`jwb-runtime-v1`のままです。

credential、database URL、backend update/admin URL、内部container名、任意操作権限を公開してはいけません。`servingGeneration`は観測情報であり操作権限ではありません。
