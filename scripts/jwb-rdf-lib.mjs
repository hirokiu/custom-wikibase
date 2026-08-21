import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { JWB_BASE_URL } from './jwb-lib.mjs';

export const RDF_MANIFEST_FILE = '/private/tmp/wfp-jwb-m2-dataset.json';
export const RDF_SNAPSHOT_FILE = '/private/tmp/wfp-jwb-m2-snapshot.nt';
export const RDF_METRICS_FILE = '/private/tmp/wfp-jwb-m2-snapshot-metrics.json';
export const RDF_ENTITY_BASE = `${JWB_BASE_URL}/entity/`;
export const RDF_PROP_BASE = `${JWB_BASE_URL}/prop/`;

export function snapshotMetrics(body, durationMs) {
  return {
    generatedAt: new Date().toISOString(),
    durationMs: Math.round(durationMs),
    bytes: Buffer.byteLength(body),
    triples: body.split('\n').filter((line) => line.trimEnd().endsWith(' .')).length,
    sha256: createHash('sha256').update(body).digest('hex')
  };
}

export function verifySnapshotSemantics(body, manifest) {
  const item = `${RDF_ENTITY_BASE}${manifest.subjectItem}`;
  const statementPrefix = `${RDF_ENTITY_BASE}statement/`;
  const required = [
    `<${item}> <${RDF_PROP_BASE}direct/${manifest.properties.string}>`,
    `<${item}> <${RDF_PROP_BASE}direct/${manifest.properties.item}> <${RDF_ENTITY_BASE}${manifest.relatedItem}>`,
    `<${item}> <${RDF_PROP_BASE}${manifest.properties.string}> <${statementPrefix}`,
    `> <${RDF_PROP_BASE}statement/${manifest.properties.string}>`,
    `> <${RDF_PROP_BASE}qualifier/${manifest.properties.qualifier}>`,
    `> <${RDF_PROP_BASE}reference/${manifest.properties.reference}>`,
    `<http://www.w3.org/2000/01/rdf-schema#label> "${ntriplesAscii('M2 RDF 適合性項目')}"@ja`,
    `<http://schema.org/description> "${ntriplesAscii('RDF バックエンド共通試験用')}"@ja`,
    `<http://www.w3.org/2004/02/skos/core#altLabel> "${ntriplesAscii('M2 試験項目')}"@ja`,
    `<http://wikiba.se/ontology#propertyType>`
  ];
  const missing = required.filter((needle) => !body.includes(needle));
  if (missing.length) throw new Error(`RDF semantic evidence missing: ${missing.join(', ')}`);
}

export function commonQueries(manifest) {
  const entity = `${RDF_ENTITY_BASE}${manifest.subjectItem}`;
  const p = RDF_PROP_BASE;
  return Object.freeze({
    item: `ASK { <${entity}> a <http://wikiba.se/ontology#Item> }`,
    directString: `ASK { <${entity}> <${p}direct/${manifest.properties.string}> "M2 direct value" }`,
    itemValue: `ASK { <${entity}> <${p}direct/${manifest.properties.item}> <${RDF_ENTITY_BASE}${manifest.relatedItem}> }`,
    externalId: `ASK { <${entity}> <${p}direct/${manifest.properties.externalId}> "JWB-M2-001" }`,
    quantity: `ASK { <${entity}> <${p}direct/${manifest.properties.quantity}> ?value }`,
    time: `ASK { <${entity}> <${p}direct/${manifest.properties.time}> ?value }`,
    statement: `ASK { <${entity}> <${p}${manifest.properties.string}> ?statement . ?statement <${p}statement/${manifest.properties.string}> "M2 direct value" }`,
    qualifier: `ASK { <${entity}> <${p}${manifest.properties.string}> ?statement . ?statement <${p}qualifier/${manifest.properties.qualifier}> "qualified" }`,
    reference: `ASK { <${entity}> <${p}${manifest.properties.string}> ?statement . ?statement <http://www.w3.org/ns/prov#wasDerivedFrom> ?reference . ?reference <${p}reference/${manifest.properties.reference}> <https://example.invalid/m2-source> }`,
    japaneseLabel: `ASK { <${entity}> <http://www.w3.org/2000/01/rdf-schema#label> "M2 RDF 適合性項目"@ja }`,
    englishLabel: `ASK { <${entity}> <http://www.w3.org/2000/01/rdf-schema#label> "M2 RDF conformance item"@en }`
  });
}

export function readManifest() { return JSON.parse(readFileSync(RDF_MANIFEST_FILE, 'utf8')); }

function ntriplesAscii(value) {
  return [...value].map((character) => {
    const point = character.codePointAt(0);
    if (point >= 0x20 && point <= 0x7e) return character;
    return point <= 0xffff ? `\\u${point.toString(16).toUpperCase().padStart(4, '0')}` : `\\U${point.toString(16).toUpperCase().padStart(8, '0')}`;
  }).join('');
}
