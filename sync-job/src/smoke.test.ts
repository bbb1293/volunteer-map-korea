import { test } from 'node:test';
import assert from 'node:assert/strict';

test('node runs .ts test files directly', () => {
  assert.equal(1 + 1, 2);
});
