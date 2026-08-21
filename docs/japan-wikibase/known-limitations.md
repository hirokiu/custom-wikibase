# Known limitations

- automatic physical generation deletionは無効
- retained rollbackは`RETIRING + ROLLBACK`で表現
- hot rollbackによりA/Bの更新コストが重複
- production backup/restore contractなし
- Oxigraph `optimize`自動化なし
- large-scale、高並行、production sizing benchmarkなし
- Kubernetes product qualificationなし
- Controller integrationなし
- AMD64 runtime qualificationはpending
- canonical hostname migrationは未対応
- documentation licenseは未決定

このため0.1.0-rc.1はlocal standalone release candidateであり、production-ready宣言ではありません。
