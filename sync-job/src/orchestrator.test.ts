import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSync } from './orchestrator.ts';
import { DataGoKrClient } from './dataGoKrClient.ts';
import type { FirestoreRepo } from './firestoreRepo.ts';
import type { VolunteerDoc } from './fieldMapping.ts';

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
