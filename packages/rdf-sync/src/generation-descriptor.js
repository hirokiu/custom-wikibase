import { JWB_PARTITION_MODEL } from "./dataset-partition.js";
import { JWB_RDF_NORMALIZATION_MODEL } from "./canonical-rdf-normalizer.js";

export function validateGenerationDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("generation descriptor must be an object");
  const descriptor = /** @type {Record<string, unknown>} */ (value);
  if (!/^gen-[a-z0-9][a-z0-9-]{0,58}$/u.test(String(descriptor.generationId)))
    throw new Error("invalid generation ID");
  if (!/^[a-z0-9][a-z0-9.-]{0,127}$/u.test(String(descriptor.sourceIdentity)))
    throw new Error("invalid source identity");
  if (
    !["virtuoso", "oxigraph", "fuseki-tdb2"].includes(
      String(descriptor.backendType),
    )
  )
    throw new Error("invalid generation backend");
  if (descriptor.partitionModel !== JWB_PARTITION_MODEL)
    throw new Error("unsupported RDF partition model");
  if (descriptor.normalizationModel !== JWB_RDF_NORMALIZATION_MODEL)
    throw new Error("unsupported RDF normalization model");
  const queryEndpoint = endpoint(descriptor.queryEndpoint, "internal-read");
  const internalUpdateEndpoint = endpoint(
    descriptor.internalUpdateEndpoint,
    "internal-write",
  );
  return Object.freeze({
    generationId: String(descriptor.generationId),
    sourceIdentity: String(descriptor.sourceIdentity),
    backendType: String(descriptor.backendType),
    normalizationModel: JWB_RDF_NORMALIZATION_MODEL,
    partitionModel: JWB_PARTITION_MODEL,
    queryEndpoint,
    internalUpdateEndpoint,
  });
}
function endpoint(value, access) {
  if (!value || typeof value !== "object" || value.access !== access)
    throw new Error("invalid generation endpoint descriptor");
  const url = new URL(String(value.url));
  const fixedKubernetesHost = /^rdf-(?:virtuoso|oxigraph|fuseki)-gen-(?:a|b)\.jwb-query-local\.svc\.cluster\.local$/u.test(url.hostname);
  const fixedStandaloneHost = /^(?:backend-a|backend-b)$/u.test(url.hostname);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && !fixedKubernetesHost && !fixedStandaloneHost) ||
    url.username ||
    url.password
  )
    throw new Error("generation endpoint must be local");
  return Object.freeze({ url: url.toString(), access });
}
