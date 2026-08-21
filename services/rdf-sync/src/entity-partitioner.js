import { RdfPartitioner } from "../../../packages/rdf-sync/src/protocol.js";
import { partitionWikibaseEntity } from "../../../packages/rdf-sync/src/dataset-partition.js";
import { normalizeWikibaseRdf } from "../../../packages/rdf-sync/src/canonical-rdf-normalizer.js";
export class WikibaseEntityPartitioner extends RdfPartitioner {
  partition(value) {
    const normalized = normalizeWikibaseRdf(value.rdf, {
      sourceKind: "ENTITY_DATA",
    });
    return partitionWikibaseEntity({ ...value, rdf: normalized.rdf });
  }
}
