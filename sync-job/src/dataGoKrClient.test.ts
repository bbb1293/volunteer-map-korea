import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataGoKrClient, CallBudgetExceededError } from './dataGoKrClient.ts';

function fakeFetch(responses: Record<string, string>): typeof fetch {
  return (async (url: string | URL) => {
    const key = Object.keys(responses).find((k) => url.toString().includes(k));
    if (!key) throw new Error(`no fake response for ${url}`);
    return new Response(responses[key], { status: 200 });
  }) as typeof fetch;
}

test('fetchListPage parses items and totalCount', async () => {
  const xml = '<response><body><totalCount>250</totalCount><items><item><progrmRegistNo>1</progrmRegistNo></item></items></body></response>';
  const client = new DataGoKrClient('KEY', 10, fakeFetch({ 'getVltrSearchWordList': xml }));
  const result = await client.fetchListPage(1);
  assert.equal(result.totalCount, 250);
  assert.equal(result.items.length, 1);
  assert.equal(client.callsMade, 1);
});

test('fetchDetail returns the raw detail item xml', async () => {
  const xml = '<response><body><items><item><progrmRegistNo>1</progrmRegistNo><rcritNmpr>5</rcritNmpr></item></items></body></response>';
  const client = new DataGoKrClient('KEY', 10, fakeFetch({ 'getVltrPartcptnItem': xml }));
  const detail = await client.fetchDetail('1');
  assert.match(detail, /<rcritNmpr>5<\/rcritNmpr>/);
  assert.equal(client.callsMade, 1);
});

test('a call beyond the budget throws CallBudgetExceededError before making a request', async () => {
  const client = new DataGoKrClient('KEY', 1, fakeFetch({
    'getVltrSearchWordList': '<response><body><totalCount>1</totalCount><items></items></body></response>',
  }));
  await client.fetchListPage(1);
  await assert.rejects(() => client.fetchListPage(2), CallBudgetExceededError);
  assert.equal(client.callsMade, 1);
});

test('remainingBudget reflects the budget minus calls made', () => {
  const client = new DataGoKrClient('KEY', 10, fakeFetch({}));
  assert.equal(client.remainingBudget, 10);
});
