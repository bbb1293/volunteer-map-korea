import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeWeekdays } from './weekday.ts';

test('a Mon-Fri bitmap collapses to a range', () => {
  assert.equal(decodeWeekdays('1111100', 'en'), 'Mon-Fri');
  assert.equal(decodeWeekdays('1111100', 'ko'), '월-금');
});

test('all seven days returns "Every day"', () => {
  assert.equal(decodeWeekdays('1111111', 'en'), 'Every day');
  assert.equal(decodeWeekdays('1111111', 'ko'), '매일');
});

test('a weekend-only bitmap collapses to Sat-Sun', () => {
  assert.equal(decodeWeekdays('0000011', 'en'), 'Sat-Sun');
});

test('non-contiguous days are listed individually', () => {
  assert.equal(decodeWeekdays('1010001', 'en'), 'Mon, Wed, Sun');
});

test('undefined or malformed input returns undefined', () => {
  assert.equal(decodeWeekdays(undefined, 'en'), undefined);
  assert.equal(decodeWeekdays('123', 'en'), undefined);
});
