// SPDX-License-Identifier: MPL-2.0
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {reconstruct} = require('../src/lib/imageOCRLayout.js');
const box = (text, x, y, width, height = 20) => ({text, poly: [[x,y], [x+width,y], [x+width,y+height], [x,y+height]]});
test('fragmented prose and math tokens become a sentence, with adjacent wrapped lines joined', () => {
  const items = [box('be',10,10,20),box('multiplied',40,10,90),box('by a scalar',140,10,100),box('λ',250,10,15),box('∈',275,10,15),box('R, and',300,10,60),box('the result is a polynomial',370,10,240),box('as described in the following example.',10,38,360)];
  const expected = 'be multiplied by a scalar λ ∈ R, and the result is a polynomial as described in the following example.';
  assert.equal(reconstruct(items), expected);
  assert.equal(reconstruct(items,'line'), expected.replace(' as described', '\n\nas described'));
  assert.equal(reconstruct(items,'raw').split('\n').length, items.length);
});
test('detector order and slight vertical offsets do not change the sentence', () => {
  const items = [box('by a scalar',140,11,100),box('be',10,10,20),box('multiplied',40,12,90)];
  assert.equal(reconstruct(items), 'be multiplied by a scalar');
});
test('headings and paragraph gaps remain separate', () => {
  const items = [box('Linear Algebra',10,0,240,30),box('This is the first long line of the paragraph.',10,45,450),box('It continues on the following printed line.',10,73,430),box('A separate paragraph begins after a larger gap.',10,120,480)];
  assert.equal(reconstruct(items).split('\n\n').length,3);
});
test('distant figure labels and neighboring columns do not become prose', () => {
  const items = [box('Determinant',10,0,110),box('Invertibility',220,0,120),box('Eigenvalues',10,70,110),box('Cholesky',420,0,90),box('Another column with a long text line.',700,0,370)];
  assert.deepEqual(reconstruct(items).split('\n\n'), ['Determinant','Invertibility','Cholesky','Another column with a long text line.','Eigenvalues']);
});
test('Chinese fragments join without inserting inter-word spaces; punctuation attaches', () => {
  assert.equal(reconstruct([box('矩阵',10,0,40),box('可以',60,0,40),box('相乘',110,0,40),box('。',160,0,20)]),'矩阵可以相乘。');
});
test('rotated labels remain independent from horizontal neighboring text', () => {
  const rotated = {text:'used in',poly:[[100,0],[100,80],[120,80],[120,0]]};
  assert.equal(reconstruct([box('Eigenvalues',10,0,80),rotated]).split('\n\n').length,2);
});
test('wrapped word hyphenation is restored and consecutive bullet items stay separate', () => {
  assert.equal(reconstruct([box('The result is a mathematical poly-',10,0,330),box('nomial in the vector space.',10,28,260)]),'The result is a mathematical polynomial in the vector space.');
  const items = [box('• The first bullet contains a long sentence.',10,0,430),box('• The second bullet is a different statement.',10,28,440)];
  assert.equal(reconstruct(items).split('\n\n').length,2);
});
