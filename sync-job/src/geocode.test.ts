import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geocodeAddress } from './geocode.ts';

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 })) as typeof fetch;
}

test('geocodeAddress returns coordinates on a successful OK response', async () => {
  const body = { status: 'OK', results: [{ geometry: { location: { lat: 37.5, lng: 127.0 } } }] };
  const result = await geocodeAddress('Some address', 'KEY', fakeFetch(body));
  assert.deepEqual(result, { lat: 37.5, lng: 127.0 });
});

test('geocodeAddress returns null when status is not OK', async () => {
  const result = await geocodeAddress('Bad address', 'KEY', fakeFetch({ status: 'ZERO_RESULTS', results: [] }));
  assert.equal(result, null);
});

test('geocodeAddress returns null on an HTTP error', async () => {
  const result = await geocodeAddress('Address', 'KEY', fakeFetch({}, false));
  assert.equal(result, null);
});
