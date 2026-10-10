import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCents } from '../app/lib/format.js';

test('formatCents renders two decimal places with a currency symbol', () => {
  assert.equal(formatCents(17499), '$174.99');
  assert.equal(formatCents(5), '$0.05');
  assert.equal(formatCents(0), '$0.00');
});

test('formatCents groups thousands', () => {
  assert.equal(formatCents(123456789), '$1,234,567.89');
});

test('formatCents honours the dataset currency', () => {
  assert.equal(formatCents(10399, 'USD'), '$103.99');
});
