import { createHash } from 'node:crypto';

/**
 * Canonicalize an RDF graph serialized as N-Triples. Blank-node labels are
 * treated as local identifiers and relabeled by exhaustive graph isomorphism.
 * Ambiguous search exceeding maxPermutations fails closed.
 * @param {string} input
 * @param {{maxPermutations?: number}} options
 */
export function canonicalizeRdfGraph(input, { maxPermutations = 100_000 } = {}) {
  if (!Number.isInteger(maxPermutations) || maxPermutations < 1 || maxPermutations > 1_000_000) throw new Error('invalid RDF canonicalization bound');
  const triples = input.split('\n').map((line) => normalizeLiteral(line.trim())).filter((line) => line && !line.startsWith('#'));
  const nodes = [...new Set(triples.flatMap(blankNodes))].sort();
  if (nodes.length === 0) return serialize(triples, new Map());
  let colors = new Map(nodes.map((node) => [node, hash(signature(node, triples, null))]));
  for (let round = 0; round <= nodes.length; round += 1) {
    const next = new Map(nodes.map((node) => [node, hash(signature(node, triples, colors))]));
    if (nodes.every((node) => next.get(node) === colors.get(node))) break;
    colors = next;
  }
  const grouped = new Map();
  for (const node of nodes) { const color = colors.get(node); grouped.set(color, [...(grouped.get(color) ?? []), node]); }
  const groups = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, values]) => values);
  const combinations = groups.reduce((value, group) => value * factorial(group.length), 1);
  if (combinations > maxPermutations) throw new Error('RDF_CANONICALIZATION_SEARCH_LIMIT');
  let best = null;
  for (const order of cartesianPermutations(groups)) {
    const labels = new Map(order.map((node, index) => [node, `_:c14n${index}`]));
    const candidate = serialize(triples, labels);
    if (best === null || candidate < best) best = candidate;
  }
  return best ?? '';
}

export function diffCanonicalRdfGraphs(left, right, options) {
  const a = new Set(canonicalizeRdfGraph(left, options).trim().split('\n').filter(Boolean));
  const b = new Set(canonicalizeRdfGraph(right, options).trim().split('\n').filter(Boolean));
  return { canonicalOnly: [...a].filter((line) => !b.has(line)), generationOnly: [...b].filter((line) => !a.has(line)) };
}

export function canonicalizeRdfDataset(input, options) {
  for (const line of input.split('\n').map((value) => value.trim()).filter(Boolean)) if (!/\s<[^>]+>\s\.$/u.test(line)) throw new Error('RDF Dataset input must be N-Quads with an IRI graph name');
  return canonicalizeRdfGraph(input, options);
}

export function diffCanonicalRdfDatasets(left, right, options) {
  const a = new Set(canonicalizeRdfDataset(left, options).trim().split('\n').filter(Boolean));
  const b = new Set(canonicalizeRdfDataset(right, options).trim().split('\n').filter(Boolean));
  return { canonicalOnly: [...a].filter((line) => !b.has(line)), generationOnly: [...b].filter((line) => !a.has(line)) };
}

function signature(node, triples, colors) {
  return triples.filter((line) => blankNodes(line).includes(node)).map((line) => line.replaceAll(node, '@SELF').replace(/_:[A-Za-z0-9][A-Za-z0-9._-]*/gu, (other) => `@${colors?.get(other) ?? 'BNODE'}`)).sort().join('\n');
}
function blankNodes(line) { return [...line.matchAll(/_:[A-Za-z0-9][A-Za-z0-9._-]*/gu)].map((match) => match[0]); }
function serialize(triples, labels) { return [...new Set(triples.map((line) => line.replace(/_:[A-Za-z0-9][A-Za-z0-9._-]*/gu, (node) => labels.get(node) ?? node)))].sort().join('\n') + '\n'; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function factorial(value) { let result = 1; for (let n = 2; n <= value; n += 1) result *= n; return result; }
function permutations(values) { if (values.length < 2) return [values]; const result = []; for (let index = 0; index < values.length; index += 1) for (const rest of permutations(values.filter((_, other) => other !== index))) result.push([values[index], ...rest]); return result; }
function* cartesianPermutations(groups, index = 0, prefix = []) { if (index === groups.length) { yield prefix; return; } for (const group of permutations(groups[index])) yield* cartesianPermutations(groups, index + 1, [...prefix, ...group]); }
function normalizeLiteral(line) {
  return line
    .replace(/\t+/gu, ' ')
    .replace(/\\u([0-9A-Fa-f]{4})|\\U([0-9A-Fa-f]{8})/gu, (_, short, long) => String.fromCodePoint(Number.parseInt(short ?? long, 16)))
    .replace(/"([+-]?)([0-9]+)(?:\.([0-9]+))?"\^\^<http:\/\/www\.w3\.org\/2001\/XMLSchema#decimal>/gu, (_, sign, integer, fraction = '') => {
      const normalizedInteger = integer.replace(/^0+(?=[0-9])/u, '');
      const normalizedFraction = fraction.replace(/0+$/u, '');
      const isZero = normalizedInteger === '0' && normalizedFraction === '';
      return `"${sign === '-' && !isZero ? '-' : ''}${normalizedInteger}${normalizedFraction ? `.${normalizedFraction}` : ''}"^^<http://www.w3.org/2001/XMLSchema#decimal>`;
    });
}
