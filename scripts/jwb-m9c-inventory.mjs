#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  datasetToNQuads,
  partitionWikibaseEntity,
  partitionWikibaseSnapshot,
} from "../packages/rdf-sync/src/dataset-partition.js";
import { diffCanonicalRdfDatasets } from "../packages/rdf-sync/src/rdf-canonicalization.js";
import { normalizeWikibaseRdf } from "../packages/rdf-sync/src/canonical-rdf-normalizer.js";
import {
  JWB_BASE_URL,
  JWB_DOCKER_CONTEXT,
  JWB_PROJECT,
  JWB_STATE_FILE,
  assertJwbDockerTarget,
  stateEnvironment,
} from "./jwb-lib.mjs";

assertLocal();
const state = JSON.parse(readFileSync(JWB_STATE_FILE, "utf8"));
stateEnvironment(state);
const d1 = dump();
await new Promise((resolve) => setTimeout(resolve, 1200));
const d2 = dump(),
  ids = entities(d1),
  entityGraphs = new Map(),normalizedEntityGraphs=new Map();
for (const entityId of ids) {
  const response = await fetch(
    `${JWB_BASE_URL}/wiki/Special:EntityData/${entityId}.nt`,
  );
  if (!response.ok)
    throw new Error(`EntityData ${entityId} HTTP ${response.status}`);
  const body=await response.text(),partition = partitionWikibaseEntity({entityId,rdf:body});
  entityGraphs.set(partition.entityGraphIri, partition.entityRdf);
  if (partition.schemaGraphIri) entityGraphs.set(partition.schemaGraphIri, partition.schemaRdf);
  const normalized = normalizeWikibaseRdf(body,{sourceKind:"ENTITY_DATA"});
  const normalizedPartition = partitionWikibaseEntity({
    entityId,
    rdf: normalized.rdf,
  });
  normalizedEntityGraphs.set(normalizedPartition.entityGraphIri, normalizedPartition.entityRdf);
  if (normalizedPartition.schemaGraphIri) normalizedEntityGraphs.set(normalizedPartition.schemaGraphIri, normalizedPartition.schemaRdf);
}
const full1 = datasetToNQuads(partitionWikibaseSnapshot(d1)),
  full2 = datasetToNQuads(partitionWikibaseSnapshot(d2)),
  entityOnly = datasetToNQuads({ graphs: entityGraphs });
const repeated = diffCanonicalRdfDatasets(full1, full2),
  sources = diffCanonicalRdfDatasets(full2, entityOnly),
  inventory = [
    ...classify(
      repeated.canonicalOnly,
      "FULL_D1_ONLY",
      "volatile-between-dumps",
    ),
    ...classify(
      repeated.generationOnly,
      "FULL_D2_ONLY",
      "volatile-between-dumps",
    ),
    ...classify(sources.canonicalOnly, "FULL_DUMP_ONLY", "source-difference"),
    ...classify(
      sources.generationOnly,
      "ENTITY_DATA_ONLY",
      "source-difference",
    ),
  ];
const normalizedD1=partitionWikibaseSnapshot(normalizeWikibaseRdf(d1,{sourceKind:"FULL_DUMP"}).rdf),normalizedD2=partitionWikibaseSnapshot(normalizeWikibaseRdf(d2,{sourceKind:"FULL_DUMP"}).rdf);normalizedEntityGraphs.set("urn:jwb:global",normalizedD2.graphs.get("urn:jwb:global")??"");const normalizedRepeated=diffCanonicalRdfDatasets(datasetToNQuads(normalizedD1),datasetToNQuads(normalizedD2)),normalizedConvergence=diffCanonicalRdfDatasets(datasetToNQuads(normalizedD2),datasetToNQuads({graphs:normalizedEntityGraphs}));
const result = {
  version: 1,
  capturedAt: new Date().toISOString(),
  wikibaseUnchanged: true,
  entities: ids,
  dumpComparison: {
    d1Only: repeated.canonicalOnly.length,
    d2Only: repeated.generationOnly.length,
  },
  sourceComparison: {
    fullDumpOnly: sources.canonicalOnly.length,
    entityDataOnly: sources.generationOnly.length,
  },
  normalized:{repeatedDump:{d1Only:normalizedRepeated.canonicalOnly.length,d2Only:normalizedRepeated.generationOnly.length},fullDumpVsEntityData:{fullDumpOnly:normalizedConvergence.canonicalOnly.length,entityDataOnly:normalizedConvergence.generationOnly.length}},
  categories: summarize(inventory),
  differences: inventory,
};
const directory = new URL("../artifacts/jwb-m9c/", import.meta.url).pathname;
mkdirSync(directory, { recursive: true });
writeFileSync(
  `${directory}difference-inventory.json`,
  `${JSON.stringify(result, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(JSON.stringify({ ...result, differences: undefined }, null, 2));

function classify(lines, source, stability) {
  return lines.map((line) => {
    const match = line.match(
      /^(<[^>]+>|_:[^ ]+)\s+(<[^>]+>)\s+(.+)\s+(<urn:jwb:[^>]+>)\s+\.$/u,
    );
    if (!match) throw new Error("unexpected N-Quads inventory line");
    const subject = match[1],
      predicate = match[2].slice(1, -1);
    return {
      predicate,
      subjectType: subject.includes("/wiki/Special:EntityData/")
        ? "entity-export"
        : subject === "<http://wikiba.se/ontology#Dump>"
          ? "dump-export"
          : subject.includes("/entity/")
            ? "wikibase-entity"
            : "other",
      source,
      stability,
      semantic: proposed(predicate, subject).semantic,
      proposedCanonicalTreatment: proposed(predicate, subject).treatment,
      evidence: line,
    };
  });
}
function proposed(predicate, subject) {
  if (subject === "<http://wikiba.se/ontology#Dump>")
    return {
      semantic: "export-provenance",
      treatment: "MOVE_TO_GENERATION_MANIFEST",
    };
  if (
    subject.includes("/wiki/Special:EntityData/") &&
    [
      "http://creativecommons.org/ns#license",
      "http://schema.org/softwareVersion",
    ].includes(predicate)
  )
    return {
      semantic: "entity-export-provenance",
      treatment: "MOVE_TO_GENERATION_MANIFEST",
    };
  return { semantic: "unclassified", treatment: "REJECT_UNKNOWN" };
}
function summarize(values) {
  const map = new Map();
  for (const value of values) {
    const key = JSON.stringify([
      value.predicate,
      value.subjectType,
      value.source,
      value.stability,
      value.semantic,
      value.proposedCanonicalTreatment,
    ]);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map].map(([key, count]) => {
    const [
      predicate,
      subjectType,
      source,
      stability,
      semantic,
      proposedCanonicalTreatment,
    ] = JSON.parse(key);
    return {
      predicate,
      subjectType,
      source,
      stability,
      semantic,
      proposedCanonicalTreatment,
      count,
    };
  });
}
function entities(rdf) {
  return [
    ...new Set(
      rdf
        .split("\n")
        .map(
          (line) =>
            line.match(
              /^<http:\/\/127\.0\.0\.1:8180\/entity\/([QP][1-9][0-9]*)>\s/u,
            )?.[1],
        )
        .filter(Boolean),
    ),
  ].sort(
    (a, b) =>
      a[0].localeCompare(b[0]) || Number(a.slice(1)) - Number(b.slice(1)),
  );
}
function dump() {
  return execFileSync(
    "docker",
    [
      "compose",
      "--project-name",
      JWB_PROJECT,
      "--file",
      new URL("../infrastructure/japan-wikibase/compose.yaml", import.meta.url)
        .pathname,
      "exec",
      "--no-TTY",
      "wikibase",
      "php",
      "extensions/Wikibase/repo/maintenance/dumpRdf.php",
      "--format",
      "nt",
      "--flavor",
      "full-dump",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DOCKER_CONTEXT: JWB_DOCKER_CONTEXT,
        ...stateEnvironment(state),
      },
    },
  );
}
function assertLocal() {
  const context = execFileSync("docker", ["context", "show"], {
      encoding: "utf8",
    }).trim(),
    [os, architecture] = execFileSync(
      "docker",
      ["info", "--format", "{{.OperatingSystem}}\n{{.Architecture}}"],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n");
  assertJwbDockerTarget({
    context,
    operatingSystem: os.includes("Docker Desktop") ? "linux" : os.toLowerCase(),
    architecture,
  });
}
