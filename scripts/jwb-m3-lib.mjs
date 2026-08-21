import { createHash } from 'node:crypto';

export function canonicalizeNTriples(text) {
  const lines = text.split('\n').map((line) => normalizeLexicalForm(line.trim())).filter((line) => line && !line.startsWith('#'));
  return [...new Set(lines)].sort().join('\n') + '\n';
}

export function entityClosure(text, entityIds, baseUrl = 'http://127.0.0.1:8180') {
  const lines = canonicalizeNTriples(text).trim().split('\n');
  const subjects = new Set(entityIds.flatMap((id) => [`${baseUrl}/entity/${id}`, `${baseUrl}/wiki/Special:EntityData/${id}`]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const line of lines) {
      const match = line.match(/^<([^>]+)>\s+<[^>]+>\s+<([^>]+)>/u);
      if (!match || !subjects.has(match[1])) continue;
      if (/\/(?:entity\/statement|value|reference)\//u.test(match[2]) && !subjects.has(match[2])) { subjects.add(match[2]); changed = true; }
    }
  }
  return lines.filter((line) => {
    const subject = line.match(/^<([^>]+)>/u)?.[1];
    return subject && subjects.has(subject);
  }).join('\n') + '\n';
}

export function diffNTriples(before, after) {
  const oldLines = new Set(canonicalizeNTriples(before).trim().split('\n').filter(Boolean));
  const newLines = new Set(canonicalizeNTriples(after).trim().split('\n').filter(Boolean));
  return { removed: [...oldLines].filter((line) => !newLines.has(line)), added: [...newLines].filter((line) => !oldLines.has(line)) };
}

export function classifyTriple(line) {
  if (line.includes('/entity/statement/')) return 'statement';
  if (line.includes('/reference/')) return 'reference';
  if (line.includes('/value/')) return 'value';
  if (line.includes('/prop/qualifier/')) return 'qualifier';
  if (line.includes('/prop/direct/')) return 'direct-claim';
  if (line.includes('rdf-schema#label')) return 'label';
  if (line.includes('schema.org/description')) return 'description';
  if (line.includes('skos/core#altLabel')) return 'alias';
  if (line.includes('Special:EntityData')) return 'entity-metadata';
  return 'other';
}

export function summarizeDiff(diff) {
  const counts = {};
  for (const [direction, lines] of Object.entries(diff)) for (const line of lines) {
    const key = `${direction}:${classifyTriple(line)}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return { added: diff.added.length, removed: diff.removed.length, classes: counts };
}

export function nodeSubjects(text) {
  return new Set([...text.matchAll(/^<([^>]+)>/gmu)].map((match) => match[1]));
}

export function sha256(text) { return createHash('sha256').update(text).digest('hex'); }

function normalizeLexicalForm(line) {
  const unicode = line.replace(/\t+/gu, ' ')
    .replace(/\\U([0-9A-Fa-f]{8})/gu, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9A-Fa-f]{4})/gu, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));
  return unicode.replace(/"(\+?-?[0-9]+(?:\.[0-9]+)?)"\^\^<http:\/\/www\.w3\.org\/2001\/XMLSchema#decimal>/gu, (_match, lexical) => {
    const unsigned = lexical.startsWith('+') ? lexical.slice(1) : lexical;
    const normalized = unsigned.includes('.') ? unsigned.replace(/0+$/u, '').replace(/\.$/u, '') : unsigned;
    return `"${normalized}"^^<http://www.w3.org/2001/XMLSchema#decimal>`;
  });
}
