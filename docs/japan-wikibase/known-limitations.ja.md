# 既知の制約

[English](known-limitations.md)

- RDF generationの物理的な自動削除は無効です。
- 保持されるrollbackは`RETIRING + ROLLBACK`として表現されます。
- hot rollbackではA/B generation slotの更新コストが重複します。
- production向けbackup/restore contractは未定義です。
- Oxigraphの`optimize`は自動化されていません。
- 大規模、高並行、production sizingのbenchmarkは未完了です。
- Kubernetes製品qualificationは未完了です。
- Controller integrationは未完了です。
- AMD64 runtime qualificationは未完了です。
- canonical hostname migrationは未対応です。
- third-party NOTICEと再配布条件は、最終的な人手レビューが必要です。

Custom Wikibaseのオリジナル文書はCC BY 4.0です。upstream由来の素材には、それぞれのupstream licenseが引き続き適用されます。詳しくは[文書ライセンス](../LICENSING.ja.md)を参照してください。

以上の理由から、`0.1.0-rc.1`はlocal standalone release candidateであり、production-ready宣言ではありません。
