# Japan Wikibase Virtuoso profile（J2-C qualification draft）

`backend=virtuoso` はJapan Wikibase Coreへ、JWB専用PostgreSQL、RecentChanges reader、generation-scoped RDF worker、固定A/B Virtuoso、read-only Query Routerを追加するstandalone Compose profileです。ControllerやFederated Platform PostgreSQLは使いません。

```sh
npm run jwb:create -- --backend=virtuoso
npm run jwb:status
npm run jwb:test
npm run jwb:stop
npm run jwb:start
npm run jwb:destroy
```

- MediaWiki: <http://127.0.0.1:8280/>
- logical SPARQL: <http://127.0.0.1:8290/sparql>
- discovery: <http://127.0.0.1:8280/.well-known/japan-wikibase-runtime>

VirtuosoのSQL、管理、update endpointはホストへ公開されません。公開SPARQLはQuery Routerを通り、query-only policyでUPDATEと任意の`SERVICE`を拒否します。discoveryは内部backend URLや資格情報を返しません。

## A/B generation

`gen-a`は`backend-a`、`gen-b`は`backend-b`へ固定対応します。両方がgeneration-scoped cursorとnamed graph registryを持ちます。serving pointerだけがlogical endpointの参照先を決めるため、URLはcutoverで変化しません。旧generationの物理volumeは自動削除されません。

`jwb:stop`はMariaDB、uploads、instance UUID、JWB PostgreSQL、cursor/pointer、Virtuoso A/B volumeを保持します。`jwb:destroy`はこれらを削除する破壊的操作です。

## 現在のqualification境界

J2-Cの実ランタイムでincremental Item/Property同期、A/B catch-up、A→B cutover、restart persistence、read-only境界までは確認済みです。一方、完全snapshot loader、full canonical Dataset equality、製品化されたdelete/undelete qualificationはまだ閉じていません。そのため、この文書時点ではVirtuosoをrelease-qualified defaultとは表示しません。

freshnessはHTTP availabilityと別です。`BOOTSTRAPPING`、`CATCHING_UP`、`STALE`では既存queryが応答してもaggregate healthはdegradedになり得ます。運用時は`jwb:status`とdiscoveryの`syncState`を併せて確認してください。

`syncLagSeconds` は Source Reader が観測した head と serving generation の cursor の差であり、両cursorが一致すればゼロです。`sourceIdleSeconds` は最後のsource eventからの経過時間です。編集がないことだけを理由に `CURRENT` を解除しません。互換フィールド `lagSeconds` は `syncLagSeconds` と同じ値です。

## J2-C1 closure blocker

既存の `GenerationDatasetLoader`、`jwb-rdf-normalization-v1`、`jwb-partition-v1` は再利用できますが、Standalone製品imageにはMediaWikiの公式 `dumpRdf.php` を実行し、安全なmanifest付きsnapshotをCoordinatorへ渡すproducer境界がまだありません。したがって、外部からテストRDFを注入する形でqualificationを成立させてはいけません。

J2-C1を閉じるには、固定A/Bの非serving slotだけを対象に、次を一つの製品操作として配線する必要があります。

1. MediaWiki RecentChanges cursor C0を取得する。
2. MediaWiki/Wikibase imageでcanonical full dumpを生成する。
3. checksum、source identity、C0、normalization/partition modelだけを含むmanifestを作る。
4. backend adapterでcandidateをresetし、partitioned snapshotをloadする。
5. candidate workerをC0から再開し、Source Readerの既知headまでcatch upする。
6. 現在のcanonical Datasetとの0/0 equalityを検証してから `READY/VALID` にする。
7. CAS promotion後も同じworkerを継続させる。

この操作はDocker socket、任意コマンド、任意URLをapplication containerへ渡してはなりません。旧serving volumeの自動削除も行いません。

## J2-C1a focused result

Standalone one-shot producer、`jwb-snapshot-v1` manifest、専用artifact volume、固定A/B candidate coordinator、および `npm run jwb:rebuild` は製品runtimeへ配線済みです。実Virtuosoでは、編集のないsnapshotについて `dumpRdf.php`、gen-b reset/load、4 named graphs、CURRENT catch-up、canonical equality 0/0、serving gen-a不変を確認しました。

snapshot開始後にMediaWiki APIで1 revisionを追加するrace testで当初発生した missing 16 / extra 16 は、Snapshot Producerだけが既定の `JWB_PUBLIC_URL=http://127.0.0.1:8180` を使い、製品 Wikibase/EntityData が `http://127.0.0.1:8280` を使っていたinstance identity不一致でした。述語、literal、revisionは一致し、全32差分がIRI baseだけの差でした。

Producerへ製品と同じcanonical public URLを固定配線した後、dump完了markerを用いた決定的race testで、C0/rcid 7のsnapshot、Q1 revision 8の増分、C1/rcid 8へのcatch-up、fresh FULL_DUMPとのmissing 0 / extra 0を確認しました。serving gen-aは不変で、candidate gen-bだけがreset/load/replace/validateされました。

これは `jwb-rdf-normalization-v1` の意味変更ではなく、既存v1が前提とする同一instance IRI identityをproducerが満たしていなかった設定バグです。そのためnormalization versionはv1のままです。Raw EntityDataは引き続きnormalizerと`jwb-partition-v1`を通し、entity graph（Propertyではschema graphも）だけをauthoritative replacementとして扱います。dump/export provenanceはDatasetではなくmanifest側へ分離します。
