import { chmod, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { partitionWikibaseSnapshot } from "../../../packages/rdf-sync/src/dataset-partition.js";
import { normalizeWikibaseRdf } from "../../../packages/rdf-sync/src/canonical-rdf-normalizer.js";

export class GenerationDatasetLoader {
  constructor({ backend, repository }) {
    this.backend = backend;
    this.repository = repository;
  }
  async loadSnapshot({ rdf }) {
    const normalization = normalizeWikibaseRdf(rdf, {
      sourceKind: "FULL_DUMP",
    });
    const dataset = partitionWikibaseSnapshot(normalization.rdf);
    await this.backend.reset({ confirmationToken: this.backend.resetToken() });
    for (const [graphIri, body] of dataset.graphs) {
      if (!body) continue;
      const path = await materialize(graphIri, body);
      try {
        await this.backend.replaceNamedGraph({
          graphIri,
          source: path,
          mediaType: "application/n-triples",
        });
      } finally {
        await unlink(path).catch(() => {});
      }
      const entityId =
        graphIri.match(
          /^urn:jwb:(?:entity:|schema:)([QP][1-9][0-9]*)$/u,
        )?.[1] ?? null;
      const partitionKind =
        graphIri === "urn:jwb:global"
          ? "GLOBAL"
          : graphIri.startsWith("urn:jwb:schema:")
            ? "PROPERTY_SCHEMA"
            : "ENTITY";
      await this.repository.registerGraph({
        graphIri,
        partitionKind,
        entityId,
      });
      if (partitionKind === "ENTITY") {
        const revision = entityRevision(body, entityId);
        await this.repository.saveEntity({
          entityId,
          indexedRevision: revision,
          latestSeenRevision: revision,
          status: "CURRENT",
          checksum: createHash("sha256").update(body).digest("hex"),
          lastSuccessAt: new Date().toISOString(),
          errorCode: null,
        });
      }
    }
    await this.repository.setSchemaState("CURRENT");
    if (typeof this.repository.saveGenerationManifest === "function")
      await this.repository.saveGenerationManifest({
        version: 1,
        normalizationModel: normalization.normalizationModel,
        partitionModel: dataset.partitionModel,
        graphCount: dataset.graphs.size,
        provenance: normalization.provenance,
      });
    return {
      graphCount: dataset.graphs.size,
      partitionModel: dataset.partitionModel,
      normalizationModel: normalization.normalizationModel,
      provenance: normalization.provenance,
    };
  }
}
async function materialize(graphIri, body) {
  const token = createHash("sha256").update(graphIri).digest("hex");
  const path = `/tmp/jwb-generation-${token}.nt`;
  await writeFile(path, body, { mode: 0o600, flag: "wx" });
  await chmod(path, 0o600);
  return path;
}
function entityRevision(body, entityId) {
  const values = new Set(
    [
      ...body.matchAll(
        new RegExp(
          `<[^>]+/(?:entity|wiki/Special:EntityData)/${entityId}> <http://schema\\.org/version> "([0-9]+)"(?:\\^\\^<http://www\\.w3\\.org/2001/XMLSchema#integer>)?`,
          "gu",
        ),
      ),
    ].map((match) => Number(match[1])),
  );
  const revision = [...values][0];
  if (values.size !== 1 || !Number.isInteger(revision) || revision < 1)
    throw new Error("SNAPSHOT_ENTITY_REVISION_AMBIGUOUS");
  return revision;
}
