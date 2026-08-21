export const JWB_PARTITION_MODEL = 'jwb-partition-v1';
export const GLOBAL_GRAPH_IRI = 'urn:jwb:global';
export function entityGraphIri(entityId) { requireEntity(entityId); return `urn:jwb:entity:${entityId}`; }
export function schemaGraphIri(propertyId) { if (!/^P[1-9][0-9]*$/u.test(propertyId)) throw new Error('invalid Property ID'); return `urn:jwb:schema:${propertyId}`; }

/** Partition a complete canonical Wikibase N-Triples graph without duplication. */
export function partitionWikibaseSnapshot(rdf) {
  const triples = parse(rdf);
  const entityIds = discoverEntities(triples);
  const assigned = new Set();
  const graphs = new Map();
  for (const entityId of entityIds) {
    const entityLines = ownedEntityLines(triples, entityId);
    put(graphs, entityGraphIri(entityId), entityLines);
    for (const line of entityLines) assigned.add(line);
    if (entityId.startsWith('P')) {
      const schemaLines = ownedPropertySchemaLines(triples, entityId);
      put(graphs, schemaGraphIri(entityId), schemaLines);
      for (const line of schemaLines) assigned.add(line);
    }
  }
  put(graphs, GLOBAL_GRAPH_IRI, triples.map((value) => value.line).filter((line) => !assigned.has(line)));
  return Object.freeze({ partitionModel: JWB_PARTITION_MODEL, graphs });
}

/** Partition one revision-specific EntityData response using the same ownership rules. */
export function partitionWikibaseEntity({ entityId, rdf }) {
  requireEntity(entityId);
  const triples = parse(rdf);
  const entityLines = ownedEntityLines(triples, entityId);
  if (entityLines.length === 0) throw new Error('entity identity absent from RDF');
  const result = { partitionModel: JWB_PARTITION_MODEL, entityId, entityGraphIri: entityGraphIri(entityId), entityRdf: text(entityLines), schemaGraphIri: null, schemaRdf: '' };
  if (entityId.startsWith('P')) { const schemaLines = ownedPropertySchemaLines(triples, entityId); result.schemaGraphIri = schemaGraphIri(entityId); result.schemaRdf = text(schemaLines); }
  return Object.freeze(result);
}

export function datasetToNQuads(dataset) {
  const lines = [];
  for (const [graphIri, body] of [...dataset.graphs].sort(([a], [b]) => a.localeCompare(b))) for (const line of body.trim().split('\n').filter(Boolean)) lines.push(`${line.slice(0, -1).trimEnd()} <${graphIri}> .`);
  return lines.sort().join('\n') + '\n';
}

function discoverEntities(triples) { const ids = new Set(); for (const value of triples) { const id = value.subject.match(/\/entity\/([QP][1-9][0-9]*)$/u)?.[1]; if (id) ids.add(id); } return [...ids].sort((a, b) => a[0].localeCompare(b[0]) || Number(a.slice(1)) - Number(b.slice(1))); }
function ownedEntityLines(triples, entityId) { const rootSuffix = `/entity/${entityId}`; const roots = new Set(triples.filter((value) => value.subject.endsWith(rootSuffix) || value.subject.endsWith(`/wiki/Special:EntityData/${entityId}`)).map((value) => value.subject)); return closure(triples, roots, (object) => /\/(?:entity\/statement|value|reference)\//u.test(object)); }
function ownedPropertySchemaLines(triples, propertyId) { const root = triples.find((value) => value.subject.endsWith(`/entity/${propertyId}`))?.subject; if (!root) return []; const seeds = new Set(triples.filter((value) => value.subject === root && value.objectType === 'iri' && triples.some((candidate) => candidate.subject === value.object) && !/\/(?:entity\/statement|value|reference)\//u.test(value.object)).map((value) => value.object)); const lines = new Set(triples.filter((value) => seeds.has(value.subject)).map((value) => value.line)); let changed = true; while (changed) { changed = false; for (const value of triples) if (lines.has(value.line) && value.objectType === 'bnode') for (const candidate of triples) if (candidate.subject === value.object && !lines.has(candidate.line)) { lines.add(candidate.line); changed = true; } } return [...lines].sort(); }
function closure(triples, roots, follow) { const owned = new Set(roots); let changed = true; while (changed) { changed = false; for (const value of triples) if (owned.has(value.subject) && value.objectType !== 'literal' && follow(value.object) && !owned.has(value.object)) { owned.add(value.object); changed = true; } } return triples.filter((value) => owned.has(value.subject)).map((value) => value.line).sort(); }
function parse(rdf) { return rdf.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => { const match = line.match(/^(<([^>]+)>|(_:[A-Za-z0-9][A-Za-z0-9._-]*))\s+<[^>]+>\s+(<([^>]+)>|(_:[A-Za-z0-9][A-Za-z0-9._-]*)|"(?:[^"\\]|\\.)*"(?:@[A-Za-z0-9-]+|\^\^<[^>]+>)?)\s*\.$/u); if (!match) throw new Error('unsupported N-Triples line'); return { line, subject: match[2] ?? match[3], object: match[5] ?? match[6] ?? match[4], objectType: match[5] ? 'iri' : match[6] ? 'bnode' : 'literal' }; }); }
function put(graphs, iri, lines) { graphs.set(iri, text(lines)); }
function text(lines) { return [...new Set(lines)].sort().join('\n') + (lines.length ? '\n' : ''); }
function requireEntity(value) { if (!/^[QP][1-9][0-9]*$/u.test(value)) throw new Error('invalid entity ID'); }
