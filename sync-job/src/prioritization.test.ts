import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDetailFetchTargets } from './prioritization.ts';

test('new items are prioritized before stale refreshes', () => {
  const result = pickDetailFetchTargets(
    ['new-1', 'new-2'],
    [{ id: 'old-1', lastDetailFetchAt: 100 }, { id: 'old-2', lastDetailFetchAt: 200 }],
    10
  );
  assert.deepEqual(result, ['new-1', 'new-2', 'old-1', 'old-2']);
});

test('stale docs are ordered oldest-first', () => {
  const result = pickDetailFetchTargets(
    [],
    [{ id: 'newer', lastDetailFetchAt: 500 }, { id: 'oldest', lastDetailFetchAt: 100 }, { id: 'middle', lastDetailFetchAt: 300 }],
    10
  );
  assert.deepEqual(result, ['oldest', 'middle', 'newer']);
});

test('the result is capped at the given budget', () => {
  const result = pickDetailFetchTargets(
    ['new-1', 'new-2', 'new-3'],
    [{ id: 'old-1', lastDetailFetchAt: 100 }],
    2
  );
  assert.deepEqual(result, ['new-1', 'new-2']);
});

test('empty inputs produce an empty result', () => {
  assert.deepEqual(pickDetailFetchTargets([], [], 100), []);
});
