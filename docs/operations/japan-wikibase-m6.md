# Japan Wikibase M6 generation lifecycle contract

## Result

The backend-neutral generation lifecycle is implemented and locally proven at the semantic contract and PostgreSQL constraint layers. Physical atomic serving cutover is **not yet proven** for Fuseki/TDB2, Virtuoso, or Oxigraph; their capability profiles remain fail-closed (`false`). No production or Controller integration was performed.

## Domain and persistence

`RdfGeneration` records generation ID, backend, state, creation time, source snapshot cursor, catch-up cursor, serving status derived from state, validation status/checksum, promotion time, retirement time, and sanitized error code. Identifiers accept only `gen-[a-z0-9-]+`; partition IRIs accept only `entity:Q/P` or `global-schema`.

Migration 006 adds generation and promotion journals. A partial unique index on `source_identity WHERE state='SERVING'` makes more than one logical serving generation impossible. Promotion records preserve from/to generation and `PREPARING`, `COMMITTED`, `ROLLED_BACK`, or `FAILED` state.

## Backend contract

The contract now includes `createGeneration`, `loadSnapshotIntoGeneration`, `applyEntityChangeToGeneration`, `deleteEntityFromGeneration`, `queryGeneration`, `validateGeneration`, `getServingGeneration`, `promoteGeneration`, `rollbackPromotion`, `retireGeneration`, `deleteGeneration`, and `listGenerations`.

New capabilities are `isolatedGenerations`, `atomicServingCutover`, `rollbackCutover`, `generationDelete`, and `generationQuery`. Metadata validation requires every capability and rejects unknown/non-boolean declarations. Base methods throw `not implemented`.

## Semantic proof

The executable memory reference verifies:

- snapshot remains invisible before promotion;
- catch-up replay precedes validation;
- promotion uses compare-and-swap against the expected serving generation;
- exactly one generation is serving;
- a stale expected pointer rejects promotion;
- rollback restores the previous serving generation;
- a serving generation cannot be retired/deleted;
- a retired/failed candidate can be removed;
- 500 catch-up changes converge to the canonical final map.

## Physical backend assessment

| Backend | Isolated physical generation | Atomic public query cutover | Rollback | M6 capability |
|---|---|---|---|---|
| Fuseki/TDB2 | not proven | not proven | not proven | false |
| Virtuoso | not proven | not proven | not proven | false |
| Oxigraph | not proven | not proven | not proven | false |

The current adapters address one HTTP dataset. A candidate named graph remains queryable in that dataset and does not provide an atomic public serving pointer. Claiming success would contradict ADR-0024. The next implementation step requires either isolated dataset processes/endpoints plus a durable atomic query router, or independently proven backend-native dataset alias switching.
