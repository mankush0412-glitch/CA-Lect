'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const { labelsFor } = require('../src/content');
const L = (...names) => names.map((name) => ({ name }));
test('a missing lecture leaves a gap in the numbers, wherever the number sits in the name', () => {
  assert.deepEqual(labelsFor(L('Lecture 1', 'Lecture 2', 'Lecture 4', 'Lecture 5')).labels, [1, 2, 4, 5]);
  const r = labelsFor(L('CA Ankit Sir - Audit Lecture 1', 'CA Ankit Sir - Audit Lecture 2', 'CA Ankit Sir - Audit Lecture 4', 'Audit Report Lec-05 (2h)'));
  assert.deepEqual(r.labels, [1, 2, 4, 5]); assert.deepEqual(r.missing, [3]);
  assert.deepEqual(labelsFor(L('Lecture 1', 'Lecture 2', 'Lecture 4'), [3]).missing, []);
  assert.deepEqual(labelsFor(L('Intro', 'Basics', 'Revision')).labels, [1, 2, 3], 'unnumbered names keep plain positions');
});
