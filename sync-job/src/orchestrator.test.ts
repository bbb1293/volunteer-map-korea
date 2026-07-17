import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSync } from './orchestrator.ts';
import { DataGoKrClient } from './dataGoKrClient.ts';
import type { FirestoreRepo } from './firestoreRepo.ts';
import type { VolunteerDoc } from './fieldMapping.ts';
import type { StaleDocRef } from './prioritization.ts';

function listXml(id: string, page: number): string {
  return `<response><body><totalCount>2</totalCount><items><item>
    <progrmRegistNo>${id}</progrmRegistNo>
    <progrmSj>Title ${id}</progrmSj>
    <nanmmbyNm>Org ${id}</nanmmbyNm>
    <progrmBgnde>20260101</progrmBgnde>
    <progrmEndde>20261231</progrmEndde>
    <srvcClCode>교육</srvcClCode>
  </item></items></body></response>`;
}

function detailXml(id: string): string {
  return `<response><body><items><item>
    <progrmRegistNo>${id}</progrmRegistNo>
    <areaLalo1>37.5,127.0</areaLalo1>
    <rcritNmpr>5</rcritNmpr>
    <appTotal>1</appTotal>
  </item></items></body></response>`;
}

function fakeFetch(): typeof fetch {
  return (async (url: string | URL) => {
    const u = url.toString();
    if (u.includes('getVltrSearchWordList')) return new Response(listXml('1', 1), { status: 200 });
    if (u.includes('getVltrPartcptnItem')) {
      const id = new URL(u).searchParams.get('progrmRegistNo')!;
      return new Response(detailXml(id), { status: 200 });
    }
    throw new Error(`unexpected url ${u}`);
  }) as typeof fetch;
}

class FakeRepo implements FirestoreRepo {
  upserted: Map<string, Partial<VolunteerDoc> & { id: string }> = new Map();
  deletedExpiredCount = 0;

  async getAllIds() {
    return new Set<string>();
  }
  async getStaleDocs() {
    return [];
  }
  async upsertDoc(doc: Partial<VolunteerDoc> & { id: string }) {
    this.upserted.set(doc.id, doc);
  }
  async deleteExpired() {
    return this.deletedExpiredCount;
  }
}

test('runSync prunes, sweeps a single list page, and detail-fetches new items', async () => {
  const repo = new FakeRepo();
  repo.deletedExpiredCount = 3;
  const client = new DataGoKrClient('KEY', 950, fakeFetch());

  const result = await runSync({ client, repo, today: new Date(2026, 5, 1) });

  assert.equal(result.pruned, 3);
  assert.equal(result.sweptPages, 1);
  assert.equal(result.detailFetched, 1);
  assert.equal(repo.upserted.size, 1);
  const doc = repo.upserted.get('1')!;
  assert.equal(doc.id, '1');
  assert.equal(doc.organization, 'Org 1');
  assert.equal(doc.lat, 37.5);
  assert.equal(doc.spotsNeeded, 5);
  assert.ok(typeof doc.lastDetailFetchAt === 'number');
});

// A repo fake with real Firestore-like semantics: `getAllIds`/`getStaleDocs` read
// back whatever has actually been persisted (with merge semantics on upsert), and
// `getStaleDocs` mirrors Firestore's `orderBy` behavior of excluding documents that
// don't have the ordered-on field at all. This is what exposes the Finding 1 bug:
// a doc upserted without `lastDetailFetchAt` is invisible to `getStaleDocs` forever.
class PersistentFakeRepo implements FirestoreRepo {
  docs: Map<string, Partial<VolunteerDoc> & { id: string }> = new Map();

  async getAllIds() {
    return new Set(this.docs.keys());
  }

  async getStaleDocs(limit: number): Promise<StaleDocRef[]> {
    return [...this.docs.values()]
      .filter((d) => Object.prototype.hasOwnProperty.call(d, 'lastDetailFetchAt'))
      .sort((a, b) => (a.lastDetailFetchAt as number) - (b.lastDetailFetchAt as number))
      .slice(0, Math.max(0, limit))
      .map((d) => ({ id: d.id, lastDetailFetchAt: d.lastDetailFetchAt as number }));
  }

  async upsertDoc(doc: Partial<VolunteerDoc> & { id: string }) {
    const existing = this.docs.get(doc.id) ?? { id: doc.id };
    this.docs.set(doc.id, { ...existing, ...doc });
  }

  async deleteExpired() {
    return 0;
  }
}

function listXmlWithId(id: string): string {
  return `<response><body><totalCount>1</totalCount><items><item>
    <progrmRegistNo>${id}</progrmRegistNo>
    <progrmSj>Title ${id}</progrmSj>
    <nanmmbyNm>Org ${id}</nanmmbyNm>
    <progrmBgnde>20260101</progrmBgnde>
    <progrmEndde>20261231</progrmEndde>
    <srvcClCode>교육</srvcClCode>
  </item></items></body></response>`;
}

function fakeFetchForId(id: string): typeof fetch {
  return (async (url: string | URL) => {
    const u = url.toString();
    if (u.includes('getVltrSearchWordList')) return new Response(listXmlWithId(id), { status: 200 });
    if (u.includes('getVltrPartcptnItem')) {
      const reqId = new URL(u).searchParams.get('progrmRegistNo')!;
      return new Response(detailXml(reqId), { status: 200 });
    }
    throw new Error(`unexpected url ${u}`);
  }) as typeof fetch;
}

test('regression: a doc swept-but-never-detail-fetched on day 1 is detail-fetched on day 2, not stuck forever', async () => {
  const repo = new PersistentFakeRepo();

  // Day 1: budget covers exactly the one list-page call and nothing else, so the
  // detail-fetch phase never runs. The item is swept (new) but never detail-fetched.
  const day1Client = new DataGoKrClient('KEY', 1, fakeFetchForId('X'));
  const day1 = await runSync({ client: day1Client, repo, today: new Date(2026, 5, 1) });

  assert.equal(day1.detailFetched, 0);
  const afterDay1 = repo.docs.get('X');
  assert.ok(afterDay1, 'doc should have been swept into the repo on day 1');
  assert.equal(
    afterDay1?.lastDetailFetchAt,
    0,
    'a newly-swept doc must get lastDetailFetchAt: 0 so it is eligible for getStaleDocs'
  );

  // Day 2: ample budget. The doc is no longer "new" (it already exists in the repo),
  // so the only way it can be detail-fetched is via getStaleDocs -- proving it did not
  // get permanently stuck the way it would have before the fix (no lastDetailFetchAt
  // field at all -> excluded from Firestore's orderBy -> invisible forever).
  const day2Client = new DataGoKrClient('KEY', 50, fakeFetchForId('X'));
  const day2 = await runSync({ client: day2Client, repo, today: new Date(2026, 5, 2) });

  assert.equal(day2.detailFetched, 1, 'the stuck doc must get detail-fetched on day 2 via getStaleDocs');
  const afterDay2 = repo.docs.get('X');
  assert.ok(afterDay2);
  assert.ok(
    typeof afterDay2?.lastDetailFetchAt === 'number' && (afterDay2!.lastDetailFetchAt as number) > 0,
    'lastDetailFetchAt must advance past 0 once the doc is actually detail-fetched'
  );
});

test('sweep upsert sets lastDetailFetchAt: 0 only for genuinely new docs, leaving existing docs untouched', async () => {
  const repo = new PersistentFakeRepo();
  // Pre-seed the repo as if doc 'Y' already existed with a real prior detail-fetch time.
  repo.docs.set('Y', { id: 'Y', title: 'Old Title', category: 'Education', status: 'Recruiting', lastDetailFetchAt: 12345 });

  const client = new DataGoKrClient('KEY', 1, fakeFetchForId('Y'));
  await runSync({ client, repo, today: new Date(2026, 5, 1) });

  const doc = repo.docs.get('Y');
  assert.ok(doc);
  assert.equal(
    doc?.lastDetailFetchAt,
    12345,
    'an already-existing doc must keep its prior lastDetailFetchAt untouched by the sweep upsert'
  );
});
