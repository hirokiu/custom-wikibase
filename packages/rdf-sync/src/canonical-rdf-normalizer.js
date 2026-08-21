import { createHash } from "node:crypto";

export const JWB_RDF_NORMALIZATION_MODEL = "jwb-rdf-normalization-v1";
const DUMP_SUBJECT = "<http://wikiba.se/ontology#Dump>";
const DUMP_PREDICATES = new Set([
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
  "http://creativecommons.org/ns#license",
  "http://schema.org/softwareVersion",
  "http://schema.org/dateModified",
  "http://www.w3.org/2002/07/owl#imports",
]);
const ENTITY_EXPORT_PREDICATES = new Set([
  "http://creativecommons.org/ns#license",
  "http://schema.org/softwareVersion",
]);

/** Normalize upstream Wikibase N-Triples before partitioning. */
export function normalizeWikibaseRdf(rdf, { sourceKind }) {
  if (!["FULL_DUMP", "ENTITY_DATA"].includes(sourceKind))
    throw new Error("invalid RDF normalization source");
  const kept = [],
    provenance = [];
  for (const raw of rdf.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const value = parse(line);
    if (value.subject === DUMP_SUBJECT) {
      if (sourceKind !== "FULL_DUMP" || !DUMP_PREDICATES.has(value.predicate))
        throw new Error("RDF_NORMALIZATION_UNKNOWN_DUMP_METADATA");
      provenance.push(evidence(value, "DUMP_EXPORT"));
      continue;
    }
    if (
      value.subject.includes("/wiki/Special:EntityData/") &&
      ENTITY_EXPORT_PREDICATES.has(value.predicate)
    ) {
      provenance.push(evidence(value, "ENTITY_EXPORT"));
      continue;
    }
    kept.push(line);
  }
  const normalizedRdf =
    [...new Set(kept)].sort().join("\n") + (kept.length ? "\n" : "");
  return Object.freeze({
    normalizationModel: JWB_RDF_NORMALIZATION_MODEL,
    rdf: normalizedRdf,
    provenance: Object.freeze(provenance),
    semanticChecksum: createHash("sha256").update(normalizedRdf).digest("hex"),
  });
}

export function generationManifest({
  generationId,
  sourceIdentity,
  sourceCursor,
  normalizations,
  mediaWikiVersion = null,
  wikibaseVersion = null,
  datasetChecksum,
  generatedAt = new Date().toISOString(),
}) {
  if (
    !/^gen-[a-z0-9][a-z0-9-]{0,58}$/u.test(generationId) ||
    !/^[a-z0-9][a-z0-9.-]{0,127}$/u.test(sourceIdentity)
  )
    throw new Error("invalid generation manifest identity");
  if (
    !sourceCursor ||
    !Number.isInteger(sourceCursor.rcid) ||
    Number.isNaN(Date.parse(sourceCursor.timestamp))
  )
    throw new Error("invalid generation manifest cursor");
  if (!/^[a-f0-9]{64}$/u.test(datasetChecksum))
    throw new Error("invalid generation Dataset checksum");
  const provenance = normalizations.flatMap((value) => value.provenance);
  const values = (predicate) =>
    [
      ...new Set(
        provenance
          .filter((value) => value.predicate === predicate)
          .map((value) => value.object),
      ),
    ].sort();
  return Object.freeze({
    version: 1,
    generationId,
    sourceIdentity,
    normalizationModel: JWB_RDF_NORMALIZATION_MODEL,
    partitionModel: "jwb-partition-v1",
    sourceCursor: Object.freeze({ ...sourceCursor }),
    generatedAt,
    exporterVersion: values("http://schema.org/softwareVersion"),
    license: values("http://creativecommons.org/ns#license"),
    mediaWikiVersion,
    wikibaseVersion,
    datasetChecksum,
    validationResult: "PENDING",
  });
}
function parse(line) {
  const match = line.match(
    /^(<[^>]+>|_:[A-Za-z0-9][A-Za-z0-9._-]*)\s+<([^>]+)>\s+(.+)\s*\.$/u,
  );
  if (!match) throw new Error("RDF_NORMALIZATION_UNSUPPORTED_SYNTAX");
  return { subject: match[1], predicate: match[2], object: match[3].trimEnd(), line };
}
function evidence(value, category) {
  return Object.freeze({
    category,
    predicate: value.predicate,
    object: value.object,
  });
}
