# Japan Wikibase M4 incremental synchronization correctness protocol

## 結論

M4 の判定は **`SAFE_WITH_REBUILD_FALLBACK`** である。RecentChanges の bounded reader、entity revision fence、exact-revision RDF fetch、entity/global partition、crash points、snapshot catch-up の契約を PoC として実装した。これは continuous production worker の承認ではない。`utirik`、production credential、Wikidata、GitHub Actions には接続していない。

## 変更ストリームと cursor

cursor は `{sourceIdentity,timestamp,rcid}`。比較順は UTC timestamp、同一秒内は rcid で、source identity が異なる cursor は拒否する。reader は localhost の固定 API、1–100 件、Item/Property namespace、必要な `ids|timestamp|flags|loginfo|comment|redirect|tags` のみに制限する。ページ再取得は cursor 以下を捨て、cursor と fence は backend 検証後にのみ永続化する。

`rcid` は単調な tie-breaker だが連番ではない。実測では Item を削除すると、その Item の通常 edit/new の RC 行が見えなくなり、delete/restore log は残った。このため `rcid + 1` を gap 条件にしてはいけない。edit gap は entity ごとの `(indexedRevision, incoming old_revid, incoming revid)` で検出する。source identity 変更、RC retention boundary 超過、continuation 無効化は source 全体を `REBUILD_REQUIRED` にする。

## lifecycle 実測

fresh local M1 で Q2–Q6 と P1 のみを操作した。完全な応答は `artifacts/jwb-m4/lifecycle-observations.json` にある。

| 操作 | 観測 | graph 処理 |
|---|---|---|
| Item delete | `logtype=delete, logaction=delete, revid=0`; API missing; EntityData 404 | entity graph を削除し tombstone cursor を保存 |
| Item undelete | `delete/restore`; revision 4 が復元; EntityData 200 | 復元された exact revision を再取得して置換 |
| direct redirect | 内容を持つ Item に `wbcreateredirect` は `origin-not-empty` | 任意に空化せず fail closed |
| merge | source Q5 と target Q6 に edit、続いて Q5 に `wbcreateredirect`; source は Q6 へ解決 | source redirect graph と target entity graph の両方を refresh |
| redirect removal | この profile では redirect の明示的 unredirect API を未実証。delete は delete log/404 | delete として除去。`mw-removed-redirect` の fixture のみ契約化 |
| Property delete | `delete/delete`; API missing; EntityData 404 | Item と同じ tombstone 処理、schema global graph を stale にする |

重要な差異として RC の `redirect` boolean は event-time の証拠ではなく現在の page state を反映した。merge 後、Q5 の過去の create 行まで `redirect=true` になった。したがって、これ単独では分類しない。delete/restore log、`mw-new-redirect` / `mw-removed-redirect` tag、`wbcreateredirect` / `wbmergeitems-*` の安定した autosummary key を候補抽出に使い、最終状態は upstream fetch で解決する。comment の自然言語本文には依存しない。

## revision-aware fetch

`wbgetentities&revids=` はこの profile では `param-missing` になったため不採用とした。代わりに MediaWiki core `action=query&revids={revision}&prop=info` で revision の title 所有を検証し、`Special:EntityData/{Q|P}.nt?revision={revision}` を取得する。title、Q/P identity、size 上限、HTTP status、`schema:version` が一致しなければ `REVISION_MISMATCH` / `ENTITY_MISSING` として graph を更新しない。

revision 3 の Q2 を revision 4 の edit 後に指定取得したところ、API は current page revision 4 を返しつつ requested revision が Q2 に属することを示し、EntityData は HTTP 200、`schema:version 3` を含んだ。current revision 4 も同様に一致した。historical exact fetch はこの profile で成立する。

## partition と global data

- entity: `urn:jwb:entity:{entityId}`。entity、statement、qualifier、reference、value closure を完全置換する。
- global/schema: Wikibase ontology、Property schema、serialization metadata を別 generation graph として snapshot/rebuild する。
- shared value/reference node は entity graphs 間で重複所有する。flat graph の subject-prefix delete は禁止。
- Property edit/delete は P graph だけでなく global/schema generation を `STALE` にし、bounded rebuild を要求する。

## state machine と persistence

状態は `BOOTSTRAPPING → CATCHING_UP → HEALTHY`。lag/health threshold 超過は `STALE`、revision chain 不一致は `GAP_DETECTED`、曖昧な write・retention loss・lifecycle 不明は `REBUILD_REQUIRED`、作業中は `REBUILDING`、再試行不能は `ERROR`。設計 SQL は `docs/design/jwb-m4-sync-state.sql` にあり、M4 では migration を実行しない。

entity fence は `indexed_revision`, `latest_seen_revision`, last cursor, graph IRI/checksum を持つ。duplicate (`revid == indexed`) と older は no-op、`old_revid == indexed` の newer edit のみ apply、そうでなければ gap。delete/restore は revision 0 の log なので log cursor と upstream resolution を transactionally 記録する別 lifecycle path が必要である。

推奨 metrics は `rdf_sync_cursor_age_seconds`, `rdf_sync_backlog_events`, `rdf_sync_entity_indexed_revision`, `rdf_sync_events_total{action,outcome}`, `rdf_sync_gap_total`, `rdf_sync_revision_mismatch_total`, `rdf_sync_graph_write_seconds{backend}`, `rdf_sync_verify_failures_total`, `rdf_sync_rebuild_total{outcome}`, `rdf_sync_rebuild_age_seconds`, `rdf_sync_state{state}`。entity ID を metric label にせず、高 cardinality は structured log/trace に置く。

## crash / duplicate / gap protocol

検証した crash points は before fetch、after fetch、before backend update、during backend update、after backend update、after fence update。最初の5点では fence が進まない。再試行は同じ complete graph の置換なので idempotent。fence commit 後の crash は duplicate no-op になる。`20,21,21,20,22` は最終 fence 22、23/old22 を fence 21 に届けると gap で停止する。

graph staging の順序は fetch exact revision → partition → checksum → temporary generation/graph load → query verification → serving graph/generation cutover → fence/cursor commit。backend write 後・fence 前の crash は再置換できるが、単一 graph の overwrite が読者に atomic だったとは仮定しない。

## snapshot + catch-up

1. source cursor C0 と source identity を同じ DB transaction で保存する。
2. serving dataset を触らず、新 generation に full dump をロードする。C0 後の RC を同時に保持する。
3. dump 中に entity が複数回変化しても、各 event を exact revision fence で順に replay する。snapshot が新しい revision を偶然含む場合も、checksum/observed revision を初期 fence にして older event を no-op にする。
4. C1 を取得し `(C0,C1]` を drain。per-entity chain、unknown lifecycle、retention boundary、graph checksum を検証する。
5. global/schema graph と entity graph union を fresh clean rebuild と比較する。
6. generation reference を backend-specific に切替え、C1 と generation を commit。atomic switch がない backend は短時間 query を停止するか `STALE` を明示する。

unit PoC では C0 snapshot Q1/rev20 に Q1/rev21 を2回 replay し、Q1/rev21 + unchanged Q2/rev7 が clean rebuild と一致した。実 RDF の dump-overlap wall-clock test は、dump に transaction/cursor fence がないため、M5 の generation adapter と durable event buffer ができるまで production claim に使わない。

## backend atomicity matrix

3 backend とも complete named graph replacement と full rebuild の semantic equality を再検証した（full-only 0 / union-only 0）。M4 再実行値は Fuseki 74 ms、Virtuoso 12 ms、Oxigraph 7 ms。

| Backend | staging graph | graph replacement | portable atomic reader visibility | generation cutover | M4 判定 |
|---|---|---|---|---|---|
| Fuseki/TDB2 | yes | Graph Store PUT | 未証明 | dataset/config specific | safe with rebuild fallback |
| Virtuoso | yes | Digest protected graph CRUD | 未証明 | dataset graph/alias specific | safe with rebuild fallback |
| Oxigraph | yes | Graph Store PUT | 未証明 | endpoint/storage specific | safe with rebuild fallback |

SPARQL `DROP` + `ADD/MOVE` を portable atomic primitive とみなさない。Graph Store PUT の途中可視性・transaction scope は backend contract の capability として個別 conformance が必要である。Blazegraph/WDQS と QLever は M4 の実行対象外で、既存 WDQS updater の互換経路を維持する。

## 推奨と M5 scope

reference backend は引き続き Fuseki/TDB2、lightweight candidate は Oxigraph、operational candidate は Virtuoso。選定を固定する証拠はまだない。

M5 は production worker ではなく、次の限定実装とする: PostgreSQL persistence migration/transaction、single-writer lease、bounded durable event buffer、RC retention/gap probe、delete/restore resolver、global-schema invalidation、backend generation adapter と backend ごとの atomicity conformance、real dump-overlap/cutover test、operator-visible rebuild/metrics。redirect removal の実エンドポイント test と Blazegraph compatibility run も gate とする。任意 URL/namespace/SPARQL SERVICE/shell は受け付けず、Controller → structured sync service → backend adapter の境界を維持する。

## 回帰と cleanup

`npm run check`, `npm run helm:check`, M1 tests、M2/M3 testsを実行対象とする。M4 はローカル fixture を変更してよいが、完了時に `npm run jwb:destroy` で M1 containers/networks/volumes/state を削除する。各 RDF backend harness は `finally` で専用 volume/network を削除する。
