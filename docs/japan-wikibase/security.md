# Security and data ownership

製品commandはDocker Desktopの固定`desktop-linux` context、固定Compose project `japan-wikibase`、allowlist済みbackendのみを使用します。Docker socketをapplication containerへ渡しません。MariaDB、JWB PostgreSQL、backend write endpointは公開せず、public SPARQL Updateを拒否します。profile stateはschema、固定project、backendのみを含み、mode `0600`です。credential stateも`0600`のローカル一時ファイルで、成果物には含めません。

データ境界:

- authoritative: MariaDB、uploads、stable runtime identity/config
- query control: JWB PostgreSQL
- derived/rebuildable: RDF backend A/B stores
- temporary: snapshot/rebuild artifacts

RDF storeは正本ではありません。production backup/restore contractは未実装です。将来のbackupではauthoritative dataとJWB PostgreSQLを一貫して保護し、RDF storesは再構築可能データとして扱います。
