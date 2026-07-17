import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoundingBox } from './firestoreEvents.ts';

test('parseBoundingBox reads valid swLat/swLng/neLat/neLng params', () => {
  const params = new URLSearchParams({ swLat: '37.4', swLng: '126.9', neLat: '37.6', neLng: '127.1' });
  assert.deepEqual(parseBoundingBox(params), { swLat: 37.4, swLng: 126.9, neLat: 37.6, neLng: 127.1 });
});

test('parseBoundingBox returns null when a param is missing', () => {
  const params = new URLSearchParams({ swLat: '37.4', swLng: '126.9', neLat: '37.6' });
  assert.equal(parseBoundingBox(params), null);
});

test('parseBoundingBox returns null when a param is not a number', () => {
  const params = new URLSearchParams({ swLat: 'abc', swLng: '126.9', neLat: '37.6', neLng: '127.1' });
  assert.equal(parseBoundingBox(params), null);
});
