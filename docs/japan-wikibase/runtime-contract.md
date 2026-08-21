# Runtime discovery contract

`GET /.well-known/japan-wikibase-runtime`は公開可能なread-only discovery documentを返します。

Core-only例:

```json
{"contractVersion":"jwb-runtime-v1","distribution":{"type":"japan-wikibase","version":"0.1.0-rc.1"},"instance":{"id":"<uuid>"},"endpoints":{"mediawiki":"http://127.0.0.1:8280/wiki/","actionApi":"http://127.0.0.1:8280/api.php"},"health":{"state":"healthy"},"queryService":{"enabled":false},"capabilities":{"queryOptional":true,"instanceStopPreservesData":true}}
```

Query有効時は`queryService`に`backendType`、logical `logicalEndpoint`、`syncState`、freshness、`servingGeneration`が加わります。`contractVersion`、distribution version、normalization version、partition versionは別々にversioningします。

credential、database URL、backend update/admin URL、内部container名、任意操作権限を公開してはいけません。`servingGeneration`は観測情報であり操作権限ではありません。
