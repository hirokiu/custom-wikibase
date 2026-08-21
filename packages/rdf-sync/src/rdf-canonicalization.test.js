import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeRdfDataset, canonicalizeRdfGraph, diffCanonicalRdfDatasets, diffCanonicalRdfGraphs } from './rdf-canonicalization.js';

test('blank-node relabeling produces identical canonical RDF graphs', () => {
  const left = '<urn:s> <urn:p> _:alpha .\n_:alpha <urn:q> "x" .\n';
  const right = '_:z9 <urn:q> "x" .\n<urn:s> <urn:p> _:z9 .\n';
  assert.equal(canonicalizeRdfGraph(left), canonicalizeRdfGraph(right));
  assert.deepEqual(diffCanonicalRdfGraphs(left, right), { canonicalOnly: [], generationOnly: [] });
});

test('symmetric blank nodes are exhaustively canonicalized and semantic differences remain', () => {
  const left = '<urn:s> <urn:p> _:a .\n<urn:s> <urn:p> _:b .\n_:a <urn:v> "1" .\n_:b <urn:v> "1" .\n';
  const renamed = left.replaceAll('_:a', '_:right').replaceAll('_:b', '_:left');
  assert.equal(canonicalizeRdfGraph(left), canonicalizeRdfGraph(renamed));
  assert.equal(diffCanonicalRdfGraphs(left, renamed.replace('"1"', '"2"')).canonicalOnly.length, 1);
});

test('ambiguous unbounded search fails closed', () => {
  const value = Array.from({ length: 9 }, (_, index) => `<urn:s> <urn:p> _:n${index} .`).join('\n');
  assert.throws(() => canonicalizeRdfGraph(value, { maxPermutations: 10 }), /SEARCH_LIMIT/u);
});

test('dataset canonicalization preserves graph identity while relabeling blank nodes', () => {
  const left = '<urn:s> <urn:p> _:a <urn:jwb:entity:Q1> .\n_:a <urn:v> "x" <urn:jwb:entity:Q1> .\n';
  const same = left.replaceAll('_:a', '_:other');
  const moved = same.replaceAll('urn:jwb:entity:Q1', 'urn:jwb:global');
  assert.equal(canonicalizeRdfDataset(left), canonicalizeRdfDataset(same));
  assert.deepEqual(diffCanonicalRdfDatasets(left, same), { canonicalOnly: [], generationOnly: [] });
  assert.ok(diffCanonicalRdfDatasets(left, moved).canonicalOnly.length > 0);
});

test('dataset canonicalization normalizes equivalent Unicode escapes and xsd:decimal lexical forms', () => {
  const escaped = '<urn:s> <urn:label> "\\u65E5\\u672C"@ja <urn:jwb:global> .\n<urn:s> <urn:value> "+0042.00"^^<http://www.w3.org/2001/XMLSchema#decimal> <urn:jwb:global> .\n';
  const native = '<urn:s> <urn:label> "日本"@ja <urn:jwb:global> .\n<urn:s> <urn:value> "42.0"^^<http://www.w3.org/2001/XMLSchema#decimal> <urn:jwb:global> .\n';
  assert.deepEqual(diffCanonicalRdfDatasets(escaped, native), { canonicalOnly: [], generationOnly: [] });
});
