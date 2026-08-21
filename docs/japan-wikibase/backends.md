# RDF backend profiles

| Profile | Classification | Role |
|---|---|---|
| none | SUPPORTED | Core-only |
| virtuoso | SUPPORTED_DEFAULT | v0.1 default |
| fuseki-tdb2 | SUPPORTED_REFERENCE | standards-oriented reference |
| oxigraph | SUPPORTED_LIGHTWEIGHT | lightweight |
| Blazegraph/WDQS | COMPATIBILITY_EXTERNAL | existing Suite compatibility lane |

Virtuosoは運用経験と適度なローカルfootprintから既定です。Fuseki/TDB2は標準的なSPARQL/RDF実装の比較基準で、qualification時のserving memory観測は463.9 MiBでした。Oxigraphは同条件で約9.9 MiBでしたが、大規模・長期storage growth、high concurrency、`optimize`運用は未検証です。これらは開発Mac上の小規模観測で、benchmarkやproduction sizingではありません。

3 backendは同一のnormalization、partition、sync worker、generation lifecycle、Query Router contractを通過しています。backend固有の公開endpointや管理commandは製品CLIに露出しません。
