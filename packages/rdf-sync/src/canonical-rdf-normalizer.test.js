import assert from "node:assert/strict";
import test from "node:test";
import {
  generationManifest,
  JWB_RDF_NORMALIZATION_MODEL,
  normalizeWikibaseRdf,
} from "./canonical-rdf-normalizer.js";
test("moves only classified full-dump provenance outside canonical RDF", () => {
  const input =
    '<http://wikiba.se/ontology#Dump> <http://schema.org/dateModified> "2026-08-19T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .\n<urn:entity> <urn:p> "semantic" .\n';
  const value = normalizeWikibaseRdf(input, { sourceKind: "FULL_DUMP" });
  assert.equal(value.rdf, '<urn:entity> <urn:p> "semantic" .\n');
  assert.equal(value.provenance.length, 1);
  assert.equal(value.normalizationModel, JWB_RDF_NORMALIZATION_MODEL);
});
test("moves repeated EntityData export metadata but retains entity semantics", () => {
  const input =
    '<http://local/wiki/Special:EntityData/Q1> <http://creativecommons.org/ns#license> <http://creativecommons.org/publicdomain/zero/1.0/> .\n<http://local/entity/Q1> <urn:p> "semantic" .\n';
  assert.equal(
    normalizeWikibaseRdf(input, { sourceKind: "ENTITY_DATA" }).rdf,
    '<http://local/entity/Q1> <urn:p> "semantic" .\n',
  );
});
test("unknown dump metadata fails closed", () =>
  assert.throws(
    () =>
      normalizeWikibaseRdf(
        '<http://wikiba.se/ontology#Dump> <urn:unknown> "x" .\n',
        { sourceKind: "FULL_DUMP" },
      ),
    /UNKNOWN_DUMP/u,
  ));
test("generation manifest carries provenance outside the query Dataset", () => {
  const normalized = normalizeWikibaseRdf(
    '<http://wikiba.se/ontology#Dump> <http://schema.org/softwareVersion> "1.0.0" .\n',
    { sourceKind: "FULL_DUMP" },
  );
  const value = generationManifest({
    generationId: "gen-a",
    sourceIdentity: "jwb-local",
    sourceCursor: { timestamp: "2026-08-19T00:00:00Z", rcid: 1 },
    normalizations: [normalized],
    datasetChecksum: "a".repeat(64),
  });
  assert.deepEqual(value.exporterVersion, ['"1.0.0"']);
  assert.equal(value.normalizationModel, JWB_RDF_NORMALIZATION_MODEL);
});
