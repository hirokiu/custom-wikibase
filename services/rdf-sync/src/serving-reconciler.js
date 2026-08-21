const ACTIVE_PROMOTIONS = new Set(['PREPARING']);

/**
 * Classify durable serving state without mutating or guessing recovery state.
 * @param {{pointer: object|null, generations: object[], promotions: object[], healthByGeneration: Map<string,string>}} input
 */
export function reconcileServingEvidence({ pointer, generations, promotions, healthByGeneration }) {
  const serving = generations.filter((value) => value.state === 'SERVING');
  const activePromotions = promotions.filter((value) => ACTIVE_PROMOTIONS.has(value.state));
  if (activePromotions.length > 0) return result('AMBIGUOUS_PROMOTION', false, activePromotions.map((value) => value.id));
  if (!pointer) return result('POINTER_MISSING', false);
  const target = generations.find((value) => value.generationId === pointer.generationId);
  if (!target) return result('POINTER_TARGET_MISSING', false, [pointer.generationId]);
  if (serving.length !== 1 || serving[0].generationId !== pointer.generationId) {
    return result('POINTER_REGISTRY_MISMATCH', false, [pointer.generationId, ...serving.map((value) => value.generationId)]);
  }
  if (healthByGeneration.get(pointer.generationId) !== 'healthy') {
    return result('SERVING_GENERATION_UNAVAILABLE', false, [pointer.generationId]);
  }
  const abandonedReady = generations.filter((value) => value.state === 'READY' && value.generationId !== pointer.previousGenerationId).map((value) => value.generationId);
  return result(abandonedReady.length ? 'CONSISTENT_WITH_READY_CANDIDATE' : 'CONSISTENT', true, abandonedReady);
}

/**
 * Select bounded retention candidates. Selection never performs deletion.
 * @param {{generations: object[], pointer: object, promotions: object[], retainFailed?: number}} input
 */
export function selectGenerationCleanupCandidates({ generations, pointer, promotions, retainFailed = 1 }) {
  if (!Number.isInteger(retainFailed) || retainFailed < 0 || retainFailed > 1) throw new Error('invalid failed-generation retention');
  const protectedIds = new Set([pointer.generationId, pointer.previousGenerationId].filter(Boolean));
  for (const promotion of promotions) if (ACTIVE_PROMOTIONS.has(promotion.state)) {
    protectedIds.add(promotion.fromGenerationId);
    protectedIds.add(promotion.toGenerationId);
  }
  const failed = generations.filter((value) => value.state === 'FAILED').sort(newestFirst);
  for (const value of failed.slice(0, retainFailed)) protectedIds.add(value.generationId);
  return generations.filter((value) => ['RETIRED', 'FAILED'].includes(value.state) && !protectedIds.has(value.generationId)).map((value) => value.generationId);
}

function result(classification, ready, relatedGenerationIds = []) { return Object.freeze({ classification, ready, relatedGenerationIds: Object.freeze([...new Set(relatedGenerationIds.filter(Boolean))]) }); }
function newestFirst(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }
