import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeNTriples, diffNTriples, entityClosure, summarizeDiff } from './jwb-m3-lib.mjs';

test('canonicalizes and diffs N-Triples deterministically', () => {
  assert.equal(canonicalizeNTriples('<b> <p> "2" .\n<a> <p> "1" .\n'), '<a> <p> "1" .\n<b> <p> "2" .\n');
  assert.deepEqual(diffNTriples('<a> <p> "1" .', '<a> <p> "2" .'), { removed: ['<a> <p> "1" .'], added: ['<a> <p> "2" .'] });
  assert.deepEqual(diffNTriples('<a> <p> "\\u65E5"@ja .\n<a> <p> "+42"^^<http://www.w3.org/2001/XMLSchema#decimal> .', '<a> <p> "日"@ja .\n<a> <p> "42"^^<http://www.w3.org/2001/XMLSchema#decimal> .'), { removed: [], added: [] });
});

test('entity closure follows statement and value nodes but excludes global schema', () => {
  const rdf = '<http://x/entity/Q1> <http://x/prop/P1> <http://x/entity/statement/Q1-a> .\n<http://x/entity/statement/Q1-a> <http://x/p> <http://x/value/v> .\n<http://x/value/v> <http://x/p> "v" .\n<http://x/entity/P1> <http://x/p> "schema" .\n';
  const closure = entityClosure(rdf, ['Q1'], 'http://x');
  assert.match(closure, /statement\/Q1-a/u);
  assert.match(closure, /value\/v/u);
  assert.doesNotMatch(closure, /entity\/P1/u);
});

test('summarizes semantic diff classes', () => {
  assert.deepEqual(summarizeDiff({ removed: [], added: ['<x> <http://www.w3.org/2000/01/rdf-schema#label> "x" .'] }), { added: 1, removed: 0, classes: { 'added:label': 1 } });
});
