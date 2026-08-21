import { selectGenerationCleanupCandidates } from './serving-reconciler.js';

export class GenerationRetirementCoordinator {
  constructor({ repository, driver, retainFailed = 1 }) { this.repository = repository; this.driver = driver; this.retainFailed = retainFailed; }

  async cleanup() {
    const evidence = await this.repository.loadServingEvidence();
    const candidates = selectGenerationCleanupCandidates({ ...evidence, retainFailed: this.retainFailed });
    const deleted = [];
    for (const generationId of candidates) {
      // Driver deletion must be idempotent: a crash may occur before the durable row is removed.
      await this.driver.deleteGeneration({ generationId });
      await this.repository.deleteRetiredGeneration({ generationId });
      deleted.push(generationId);
    }
    return Object.freeze({ deleted });
  }
}
