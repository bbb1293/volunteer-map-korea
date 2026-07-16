# Firestore Sync Job Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace live per-request data.go.kr calls with a daily Cloud Run Job that syncs listings into Firestore, and switch the web app to viewport-based Firestore queries instead of loading the whole dataset.

**Architecture:** A standalone `sync-job/` Node project runs as a Cloud Run Job on a Cloud Scheduler cron, walking data.go.kr's list/detail endpoints under a fixed call budget and upserting into a Firestore `volunteerEvents` collection. The existing Next.js web service drops its data.go.kr/geocoding logic entirely and instead runs a lat/lng bounding-box query against Firestore, driven by the map's current viewport.

**Tech Stack:** TypeScript executed directly by Node's native type-stripping (Node 25, no build step, no bundler) — confirmed available via `node -v` (v25.9.0) in this environment. `@google-cloud/firestore` Admin SDK. Terraform for all new GCP infra. Node's built-in `node --test` runner for unit tests — no new test framework dependency.

## Global Constraints

- Firestore: Native mode, region `asia-northeast3` (co-located with Cloud Run).
- Sync job: hard-stop at ~950 data.go.kr calls per run (headroom under the ~1,000/day quota).
- Expired listings (`expiresOn < today`) are **deleted** from Firestore, not flagged.
- `organization` must be sourced from the **list** endpoint's `nanmmbyNm` tag. The **detail** endpoint's `nanmmbyNm` tag is a different field (overseeing district office) — never let it overwrite `organization`.
- `lat`/`lng` are stored as **top-level numeric fields** on each document (not nested), so they're indexable for range queries.
- Composite Firestore index required: `(lat ASC, lng ASC)`.
- Zoom cutoff for hiding all pins: below city/metro-level zoom, i.e. Kakao map `level >= 9` (this app's existing scale is 1-14, lower = more zoomed in; city/metro level was chosen as level 8-9 in the design, so the cutoff renders no pins at `level >= 9`).
- Viewport refetch debounce: 300-500ms after the map's `idle` event (use 400ms).
- TypeScript in `sync-job/` must stay within Node's erasable-syntax subset: no `enum`, no `namespace`, no constructor parameter-property shorthand (declare fields explicitly instead).
- Web service's Firestore reads use `roles/datastore.viewer`; the sync job's writes use `roles/datastore.user`. Web service no longer needs `DATA_GO_KR_API_KEY` or `GOOGLE_MAPS_API_KEY`.

---

## Task 1: Scaffold the sync-job project and verify the test runner

**Files:**
- Create: `sync-job/package.json`
- Create: `sync-job/tsconfig.json`
- Create: `sync-job/.gitignore`
- Test: `sync-job/src/smoke.test.ts`

**Interfaces:**
- Produces: confirms `node --test src/*.test.ts` runs `.ts` files directly with zero extra dependencies, which every later task in `sync-job/` relies on.

- [ ] **Step 1: Create the project manifest**

```json
{
  "name": "volunteer-map-sync-job",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test src/*.test.ts",
    "typecheck": "tsc --noEmit",
    "start": "node src/index.ts"
  },
  "dependencies": {
    "@google-cloud/firestore": "^7.11.0"
  },
  "devDependencies": {
    "@types/node": "^22",
    "typescript": "^5.8"
  }
}
```

- [ ] **Step 2: Create `sync-job/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "erasableSyntaxOnly": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `sync-job/.gitignore`**

```
node_modules/
```

- [ ] **Step 4: Write a smoke test to confirm the runner works**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('node runs .ts test files directly', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 5: Install dependencies and run the test**

Run: `cd sync-job && npm install && npm test`
Expected: `# pass 1` and exit code 0, with no TypeScript build step in between.

- [ ] **Step 6: Commit**

```bash
git add sync-job/package.json sync-job/package-lock.json sync-job/tsconfig.json sync-job/.gitignore sync-job/src/smoke.test.ts
git commit -m "chore(sync-job): scaffold project, confirm native TS test execution"
```

---

## Task 2: XML parsing helpers

**Files:**
- Create: `sync-job/src/xml.ts`
- Test: `sync-job/src/xml.test.ts`

**Interfaces:**
- Produces: `decodeXmlEntities(str: string): string`, `extractTagValue(xml: string, tagName: string): string`, `extractItems(xml: string): string[]`, `formatDate(raw: string | undefined): string | undefined`, `formatTime(raw: string | undefined): string | undefined`, `parseAreaLalo(raw: string | undefined): { lat: number; lng: number } | null` — consumed by Task 3's field mapping and Task 5's API client.

- [ ] **Step 1: Delete the now-redundant smoke test**

```bash
rm sync-job/src/smoke.test.ts
```

- [ ] **Step 2: Write the failing tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeXmlEntities, extractTagValue, extractItems, formatDate, formatTime, parseAreaLalo } from './xml.ts';

test('decodeXmlEntities unwraps CDATA and decodes entities', () => {
  assert.equal(decodeXmlEntities('<![CDATA[Hello &amp; goodbye]]>'), 'Hello & goodbye');
  assert.equal(decodeXmlEntities('  plain &lt;text&gt;  '), 'plain <text>');
});

test('extractTagValue finds a tag value case-insensitively and trims CDATA', () => {
  const xml = '<item><progrmSj><![CDATA[Test Title]]></progrmSj></item>';
  assert.equal(extractTagValue(xml, 'progrmSj'), 'Test Title');
  assert.equal(extractTagValue(xml, 'missingTag'), '');
});

test('extractItems splits a list/detail response into item blocks', () => {
  const xml = '<items><item><a>1</a></item><item><a>2</a></item></items>';
  const items = extractItems(xml);
  assert.equal(items.length, 2);
  assert.equal(extractTagValue(items[0], 'a'), '1');
  assert.equal(extractTagValue(items[1], 'a'), '2');
});

test('formatDate converts YYYYMMDD to YYYY.MM.DD', () => {
  assert.equal(formatDate('20260511'), '2026.05.11');
  assert.equal(formatDate(undefined), undefined);
  assert.equal(formatDate('bad'), undefined);
});

test('formatTime converts an hour string to HH:00', () => {
  assert.equal(formatTime('8'), '08:00');
  assert.equal(formatTime('16'), '16:00');
  assert.equal(formatTime(undefined), undefined);
  assert.equal(formatTime('25'), undefined);
});

test('parseAreaLalo parses comma-delimited coordinates within South Korea bounds', () => {
  assert.deepEqual(parseAreaLalo('37.4569614,127.0191675'), { lat: 37.4569614, lng: 127.0191675 });
  assert.equal(parseAreaLalo('0,0'), null);
  assert.equal(parseAreaLalo(undefined), null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd sync-job && npm test`
Expected: FAIL — `Cannot find module './xml.ts'`

- [ ] **Step 4: Implement `sync-job/src/xml.ts`**

```ts
export function decodeXmlEntities(str: string): string {
  let val = str.trim();
  const cdataMatch = val.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  if (cdataMatch) {
    val = cdataMatch[1].trim();
  }
  return val
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/\r\n|\r/g, '\n')
    .trim();
}

export function extractTagValue(xml: string, tagName: string): string {
  const regex = new RegExp('<' + tagName + '\\b[^>]*>([\\s\\S]*?)</' + tagName + '>', 'i');
  const match = xml.match(regex);
  if (!match) return '';
  return decodeXmlEntities(match[1]);
}

export function extractItems(xml: string): string[] {
  const items: string[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    items.push(match[1]);
  }
  return items;
}

export function formatDate(raw: string | undefined): string | undefined {
  if (!raw || raw.length !== 8) return undefined;
  return `${raw.slice(0, 4)}.${raw.slice(4, 6)}.${raw.slice(6, 8)}`;
}

export function formatTime(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const hour = parseInt(raw, 10);
  if (isNaN(hour) || hour < 0 || hour > 24) return undefined;
  return `${String(hour).padStart(2, '0')}:00`;
}

export function parseAreaLalo(raw: string | undefined): { lat: number; lng: number } | null {
  if (!raw) return null;
  const parts = raw.split(/[,;\s]+/).map((p) => parseFloat(p)).filter((n) => !isNaN(n));
  if (parts.length < 2) return null;
  const [lat, lng] = parts;
  if (lat < 33 || lat > 39 || lng < 124 || lng > 132) return null;
  return { lat, lng };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd sync-job && npm test`
Expected: all 6 tests pass.

- [ ] **Step 6: Type-check**

Run: `cd sync-job && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add sync-job/src/xml.ts sync-job/src/xml.test.ts
git rm sync-job/src/smoke.test.ts
git commit -m "feat(sync-job): port XML parsing helpers with tests"
```

---

## Task 3: Field mapping (list + detail merge)

**Files:**
- Create: `sync-job/src/fieldMapping.ts`
- Test: `sync-job/src/fieldMapping.test.ts`

**Interfaces:**
- Consumes: `extractTagValue`, `formatDate`, `formatTime`, `parseAreaLalo` from `./xml.ts` (Task 2).
- Produces: `interface VolunteerDoc` (the Firestore document shape), `CATEGORY_NAMES`, `mapListItem(itemXml: string, pageNo: number, today: Date): Partial<VolunteerDoc> | null`, `mergeDetailFields(doc: Partial<VolunteerDoc>, detailItemXml: string): Partial<VolunteerDoc>` — consumed by Task 8's orchestrator.

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapListItem, mergeDetailFields } from './fieldMapping.ts';

const LIST_ITEM_XML = `
  <actBeginTm>8</actBeginTm>
  <actEndTm>16</actEndTm>
  <actPlace>서울우솔초등학교</actPlace>
  <adultPosblAt>Y</adultPosblAt>
  <gugunCd>3210000</gugunCd>
  <nanmmbyNm>서울우솔초등학교</nanmmbyNm>
  <noticeBgnde>20260501</noticeBgnde>
  <noticeEndde>20260716</noticeEndde>
  <progrmBgnde>20260511</progrmBgnde>
  <progrmEndde>20260717</progrmEndde>
  <progrmRegistNo>3423604</progrmRegistNo>
  <progrmSj>우솔초등학교 특수교육대상학생 통합학급 학습 지도 및 수업 지원</progrmSj>
  <progrmSttusSe>3</progrmSttusSe>
  <sidoCd>6110000</sidoCd>
  <srvcClCode>교육</srvcClCode>
  <url>https://1365.go.kr/vols/P9210/partcptn/timeCptn.do?type=show&amp;progrmRegistNo=3423604</url>
  <yngbgsPosblAt>N</yngbgsPosblAt>
`;

const DETAIL_ITEM_XML = `
  <areaLalo1>37.4570942208519,127.019275619438</areaLalo1>
  <email>iwkang33@gmail.com</email>
  <familyPosblAt>N</familyPosblAt>
  <grpPosblAt>N</grpPosblAt>
  <mnnstNm>서울우솔초등학교</mnnstNm>
  <nanmmbyNm>서울특별시 서초구</nanmmbyNm>
  <pbsvntPosblAt>N</pbsvntPosblAt>
  <progrmCn>봉사자 모집 설명</progrmCn>
  <rcritNmpr>1</rcritNmpr>
  <appTotal>0</appTotal>
  <actWkdy>1111100</actWkdy>
  <telno>02-3463-9069</telno>
`;

test('mapListItem extracts fields and formats dates from the list endpoint', () => {
  const doc = mapListItem(LIST_ITEM_XML, 1, new Date(2026, 5, 1));
  assert.ok(doc);
  assert.equal(doc!.id, '3423604');
  assert.equal(doc!.organization, '서울우솔초등학교');
  assert.equal(doc!.startDate, '2026.05.11');
  assert.equal(doc!.endDate, '2026.07.17');
  assert.equal(doc!.recruitStartDate, '2026.05.01');
  assert.equal(doc!.recruitEndDate, '2026.07.16');
  assert.equal(doc!.category, 'Education');
  assert.equal(doc!.adultPosblAt, 'Y');
  assert.equal(doc!.yngbgsPosblAt, 'N');
  assert.equal(doc!.sourcePage, 1);
  assert.equal(doc!.expiresOn, '2026-07-17');
});

test('mapListItem returns null for a listing whose activity period already ended', () => {
  const doc = mapListItem(LIST_ITEM_XML, 1, new Date(2027, 0, 1));
  assert.equal(doc, null);
});

test('mapListItem returns null when id or title is missing', () => {
  const doc = mapListItem('<progrmSj>Only a title</progrmSj>', 1, new Date(2026, 5, 1));
  assert.equal(doc, null);
});

test('mergeDetailFields uses the LIST endpoint organization, not the detail endpoint one', () => {
  const listDoc = mapListItem(LIST_ITEM_XML, 1, new Date(2026, 5, 1))!;
  const merged = mergeDetailFields(listDoc, DETAIL_ITEM_XML);
  assert.equal(merged.organization, '서울우솔초등학교');
  assert.notEqual(merged.organization, '서울특별시 서초구');
});

test('mergeDetailFields pulls coordinates, description, spots, eligibility, schedule, and contact info', () => {
  const listDoc = mapListItem(LIST_ITEM_XML, 1, new Date(2026, 5, 1))!;
  const merged = mergeDetailFields(listDoc, DETAIL_ITEM_XML);
  assert.equal(merged.lat, 37.4570942208519);
  assert.equal(merged.lng, 127.019275619438);
  assert.equal(merged.description, '봉사자 모집 설명');
  assert.equal(merged.spotsNeeded, 1);
  assert.equal(merged.spotsFilled, 0);
  assert.equal(merged.familyPosblAt, 'N');
  assert.equal(merged.grpPosblAt, 'N');
  assert.equal(merged.pbsvntPosblAt, 'N');
  assert.equal(merged.actWkdy, '1111100');
  assert.equal(merged.email, 'iwkang33@gmail.com');
  assert.equal(merged.telno, '02-3463-9069');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sync-job && npm test`
Expected: FAIL — `Cannot find module './fieldMapping.ts'`

- [ ] **Step 3: Implement `sync-job/src/fieldMapping.ts`**

```ts
import { extractTagValue, formatDate, formatTime, parseAreaLalo } from './xml.ts';

export const CATEGORY_NAMES: Record<string, string> = {
  '생활편의': 'Living Support',
  '주거환경': 'Housing & Environment',
  '상담ㆍ멘토링': 'Counseling & Mentoring',
  '교육': 'Education',
  '보건ㆍ의료': 'Health & Medical',
  '농어촌 봉사': 'Rural Community',
  '문화ㆍ체육ㆍ예술ㆍ관광': 'Culture, Sports & Tourism',
  '환경ㆍ생태계보호': 'Environment',
  '사무행정': 'Administration',
  '지역안전ㆍ보호': 'Community Safety',
  '인권ㆍ공익': 'Human Rights & Public Interest',
  '재난ㆍ재해': 'Disaster Relief',
  '국제협력ㆍ해외봉사': 'International Cooperation',
  '기타': 'Other',
  '자원봉사 기본교육': 'Volunteer Basic Training',
  '온라인자원봉사': 'Online Volunteering',
};

export interface VolunteerDoc {
  id: string;
  title: string;
  organization?: string;
  category: string;
  status: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  recruitStartDate?: string;
  recruitEndDate?: string;
  externalUrl?: string;
  description?: string;
  spotsNeeded?: number;
  spotsFilled?: number;
  lat?: number;
  lng?: number;
  address?: string;
  adultPosblAt?: string;
  yngbgsPosblAt?: string;
  familyPosblAt?: string;
  grpPosblAt?: string;
  pbsvntPosblAt?: string;
  actWkdy?: string;
  email?: string;
  telno?: string;
  expiresOn?: string;
  lastDetailFetchAt?: number;
  sourcePage?: number;
}

function toIsoDate(raw: string): string | undefined {
  if (raw.length !== 8) return undefined;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export function mapListItem(itemXml: string, pageNo: number, today: Date): Partial<VolunteerDoc> | null {
  const id = extractTagValue(itemXml, 'progrmRegistNo');
  const title = extractTagValue(itemXml, 'progrmSj');
  if (!id || !title) return null;

  const startDateRaw = extractTagValue(itemXml, 'progrmBgnde');
  const endDateRaw = extractTagValue(itemXml, 'progrmEndde');
  const referenceDateRaw = endDateRaw || startDateRaw;

  if (referenceDateRaw && referenceDateRaw.length === 8) {
    const y = parseInt(referenceDateRaw.slice(0, 4), 10);
    const m = parseInt(referenceDateRaw.slice(4, 6), 10);
    const d = parseInt(referenceDateRaw.slice(6, 8), 10);
    const refDate = new Date(y, m - 1, d);
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    if (!isNaN(refDate.getTime()) && refDate < todayStart) return null;
  }

  const categoryCode = extractTagValue(itemXml, 'srvcClCode');

  return {
    id,
    title,
    organization: extractTagValue(itemXml, 'nanmmbyNm') || undefined,
    category: CATEGORY_NAMES[categoryCode] || categoryCode || 'Volunteer',
    status: 'Recruiting',
    startDate: formatDate(startDateRaw),
    endDate: formatDate(endDateRaw),
    startTime: formatTime(extractTagValue(itemXml, 'actBeginTm')),
    endTime: formatTime(extractTagValue(itemXml, 'actEndTm')),
    recruitStartDate: formatDate(extractTagValue(itemXml, 'noticeBgnde')),
    recruitEndDate: formatDate(extractTagValue(itemXml, 'noticeEndde')),
    externalUrl: extractTagValue(itemXml, 'url') || undefined,
    address: extractTagValue(itemXml, 'actPlace') || undefined,
    adultPosblAt: extractTagValue(itemXml, 'adultPosblAt') || undefined,
    yngbgsPosblAt: extractTagValue(itemXml, 'yngbgsPosblAt') || undefined,
    expiresOn: toIsoDate(referenceDateRaw),
    sourcePage: pageNo,
  };
}

// Detail-endpoint fields only. `nanmmbyNm` is deliberately NOT read here —
// on this endpoint it names the overseeing district office, not the host
// org, and would silently corrupt `organization` if merged in.
export function mergeDetailFields(doc: Partial<VolunteerDoc>, detailItemXml: string): Partial<VolunteerDoc> {
  const coords =
    parseAreaLalo(extractTagValue(detailItemXml, 'areaLalo1')) ||
    parseAreaLalo(extractTagValue(detailItemXml, 'areaLalo2')) ||
    parseAreaLalo(extractTagValue(detailItemXml, 'areaLalo3'));

  const rcritNmpr = parseInt(extractTagValue(detailItemXml, 'rcritNmpr'), 10);
  const appTotal = parseInt(extractTagValue(detailItemXml, 'appTotal'), 10);

  return {
    ...doc,
    lat: coords?.lat,
    lng: coords?.lng,
    description: extractTagValue(detailItemXml, 'progrmCn') || undefined,
    spotsNeeded: isNaN(rcritNmpr) ? undefined : rcritNmpr,
    spotsFilled: isNaN(appTotal) ? undefined : appTotal,
    familyPosblAt: extractTagValue(detailItemXml, 'familyPosblAt') || undefined,
    grpPosblAt: extractTagValue(detailItemXml, 'grpPosblAt') || undefined,
    pbsvntPosblAt: extractTagValue(detailItemXml, 'pbsvntPosblAt') || undefined,
    actWkdy: extractTagValue(detailItemXml, 'actWkdy') || undefined,
    email: extractTagValue(detailItemXml, 'email') || undefined,
    telno: extractTagValue(detailItemXml, 'telno') || undefined,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sync-job && npm test`
Expected: all tests pass (6 from Task 2 + 5 from this task).

- [ ] **Step 5: Type-check**

Run: `cd sync-job && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add sync-job/src/fieldMapping.ts sync-job/src/fieldMapping.test.ts
git commit -m "feat(sync-job): field mapping for list/detail merge with organization-source guard"
```

---

## Task 4: Detail-fetch prioritization logic

**Files:**
- Create: `sync-job/src/prioritization.ts`
- Test: `sync-job/src/prioritization.test.ts`

**Interfaces:**
- Produces: `interface StaleDocRef { id: string; lastDetailFetchAt: number }`, `pickDetailFetchTargets(newIds: string[], staleDocs: StaleDocRef[], budget: number): string[]` — consumed by Task 8's orchestrator.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sync-job && npm test`
Expected: FAIL — `Cannot find module './prioritization.ts'`

- [ ] **Step 3: Implement `sync-job/src/prioritization.ts`**

```ts
export interface StaleDocRef {
  id: string;
  lastDetailFetchAt: number;
}

export function pickDetailFetchTargets(newIds: string[], staleDocs: StaleDocRef[], budget: number): string[] {
  const orderedStale = [...staleDocs].sort((a, b) => a.lastDetailFetchAt - b.lastDetailFetchAt).map((d) => d.id);
  return [...newIds, ...orderedStale].slice(0, Math.max(0, budget));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sync-job && npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add sync-job/src/prioritization.ts sync-job/src/prioritization.test.ts
git commit -m "feat(sync-job): detail-fetch prioritization (new-first, then oldest-stale)"
```

---

## Task 5: data.go.kr client with a hard call-budget stop

**Files:**
- Create: `sync-job/src/dataGoKrClient.ts`
- Test: `sync-job/src/dataGoKrClient.test.ts`

**Interfaces:**
- Consumes: `extractItems`, `extractTagValue` from `./xml.ts` (Task 2).
- Produces: `class CallBudgetExceededError extends Error`, `class DataGoKrClient` with `constructor(serviceKey: string, budget: number, fetchImpl?: typeof fetch)`, `fetchListPage(pageNo: number): Promise<{ items: string[]; totalCount: number }>`, `fetchDetail(id: string): Promise<string>`, `get callsMade(): number`, `get remainingBudget(): number` — consumed by Task 8's orchestrator, which derives its phase-3 budget from `client.remainingBudget` rather than duplicating the `950` constant.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sync-job && npm test`
Expected: FAIL — `Cannot find module './dataGoKrClient.ts'`

- [ ] **Step 3: Implement `sync-job/src/dataGoKrClient.ts`**

```ts
import { extractItems, extractTagValue } from './xml.ts';

export class CallBudgetExceededError extends Error {
  constructor() {
    super('data.go.kr call budget exceeded for this run');
    this.name = 'CallBudgetExceededError';
  }
}

const BASE_URL = 'https://apis.data.go.kr/1741000/volunteerPartcptnService';

export class DataGoKrClient {
  private serviceKey: string;
  private budget: number;
  private fetchImpl: typeof fetch;
  private calls: number;

  constructor(serviceKey: string, budget: number, fetchImpl: typeof fetch = fetch) {
    this.serviceKey = serviceKey;
    this.budget = budget;
    this.fetchImpl = fetchImpl;
    this.calls = 0;
  }

  get callsMade(): number {
    return this.calls;
  }

  get remainingBudget(): number {
    return this.budget - this.calls;
  }

  private async request(url: string): Promise<string> {
    if (this.calls >= this.budget) {
      throw new CallBudgetExceededError();
    }
    this.calls += 1;
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`data.go.kr HTTP error: ${response.status} ${response.statusText}`);
    }
    const xmlText = await response.text();
    const resultCode = extractTagValue(xmlText, 'resultCode');
    if (resultCode && resultCode !== '00' && resultCode !== '0000') {
      throw new Error(`data.go.kr returned error code ${resultCode}: ${extractTagValue(xmlText, 'resultMsg')}`);
    }
    return xmlText;
  }

  private encodedKey(): string {
    return this.serviceKey.includes('%') ? this.serviceKey : encodeURIComponent(this.serviceKey);
  }

  async fetchListPage(pageNo: number): Promise<{ items: string[]; totalCount: number }> {
    const url = `${BASE_URL}/getVltrSearchWordList?serviceKey=${this.encodedKey()}&numOfRows=100&pageNo=${pageNo}`;
    const xmlText = await this.request(url);
    const totalCount = parseInt(extractTagValue(xmlText, 'totalCount'), 10);
    return { items: extractItems(xmlText), totalCount: isNaN(totalCount) ? 0 : totalCount };
  }

  async fetchDetail(id: string): Promise<string> {
    const url = `${BASE_URL}/getVltrPartcptnItem?serviceKey=${this.encodedKey()}&progrmRegistNo=${encodeURIComponent(id)}`;
    const xmlText = await this.request(url);
    const items = extractItems(xmlText);
    return items[0] ?? xmlText;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sync-job && npm test`
Expected: all tests pass.

- [ ] **Step 5: Type-check**

Run: `cd sync-job && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add sync-job/src/dataGoKrClient.ts sync-job/src/dataGoKrClient.test.ts
git commit -m "feat(sync-job): data.go.kr client with hard call-budget stop"
```

---

## Task 6: Geocoding fallback

**Files:**
- Create: `sync-job/src/geocode.ts`
- Test: `sync-job/src/geocode.test.ts`

**Interfaces:**
- Produces: `geocodeAddress(address: string, apiKey: string, fetchImpl?: typeof fetch): Promise<{ lat: number; lng: number } | null>` — consumed by Task 8's orchestrator when a detail response has no usable `areaLalo*` coordinates.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sync-job && npm test`
Expected: FAIL — `Cannot find module './geocode.ts'`

- [ ] **Step 3: Implement `sync-job/src/geocode.ts`**

```ts
export async function geocodeAddress(
  address: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
      const loc = data.results[0].geometry.location;
      if (typeof loc.lat === 'number' && typeof loc.lng === 'number') {
        return { lat: loc.lat, lng: loc.lng };
      }
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sync-job && npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add sync-job/src/geocode.ts sync-job/src/geocode.test.ts
git commit -m "feat(sync-job): geocoding fallback for listings without usable coordinates"
```

---

## Task 7: Firestore repository

**Files:**
- Create: `sync-job/src/firestoreRepo.ts`

**Interfaces:**
- Consumes: `VolunteerDoc` from `./fieldMapping.ts` (Task 3), `StaleDocRef` from `./prioritization.ts` (Task 4).
- Produces: `interface FirestoreRepo` with `getAllIds(): Promise<Set<string>>`, `getStaleDocs(limit: number): Promise<StaleDocRef[]>`, `upsertDoc(doc: Partial<VolunteerDoc> & { id: string }): Promise<void>`, `deleteExpired(todayIso: string): Promise<number>`, and `class FirestoreRepoImpl implements FirestoreRepo` — consumed by Task 8's orchestrator and Task 9's entrypoint. No unit test in this task: it is a thin wrapper around `@google-cloud/firestore` with no branching logic of its own: the interface is what makes Task 8 testable via a hand-written fake, and this class's correctness is verified end-to-end in Task 11 against a real Firestore instance.

- [ ] **Step 1: Implement `sync-job/src/firestoreRepo.ts`**

```ts
import { Firestore } from '@google-cloud/firestore';
import type { VolunteerDoc } from './fieldMapping.ts';
import type { StaleDocRef } from './prioritization.ts';

const COLLECTION = 'volunteerEvents';

export interface FirestoreRepo {
  getAllIds(): Promise<Set<string>>;
  getStaleDocs(limit: number): Promise<StaleDocRef[]>;
  upsertDoc(doc: Partial<VolunteerDoc> & { id: string }): Promise<void>;
  deleteExpired(todayIso: string): Promise<number>;
}

export class FirestoreRepoImpl implements FirestoreRepo {
  private db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  async getAllIds(): Promise<Set<string>> {
    const snapshot = await this.db.collection(COLLECTION).select().get();
    return new Set(snapshot.docs.map((d) => d.id));
  }

  async getStaleDocs(limit: number): Promise<StaleDocRef[]> {
    const snapshot = await this.db
      .collection(COLLECTION)
      .orderBy('lastDetailFetchAt', 'asc')
      .limit(limit)
      .get();
    return snapshot.docs.map((d) => ({ id: d.id, lastDetailFetchAt: d.get('lastDetailFetchAt') ?? 0 }));
  }

  async upsertDoc(doc: Partial<VolunteerDoc> & { id: string }): Promise<void> {
    const { id, ...fields } = doc;
    await this.db.collection(COLLECTION).doc(id).set(fields, { merge: true });
  }

  async deleteExpired(todayIso: string): Promise<number> {
    const snapshot = await this.db.collection(COLLECTION).where('expiresOn', '<', todayIso).get();
    const batch = this.db.batch();
    snapshot.docs.forEach((d) => batch.delete(d.ref));
    if (snapshot.docs.length > 0) await batch.commit();
    return snapshot.docs.length;
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd sync-job && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add sync-job/src/firestoreRepo.ts
git commit -m "feat(sync-job): Firestore repository wrapper"
```

---

## Task 8: Orchestrator (prune → sweep → detail-fetch)

**Files:**
- Create: `sync-job/src/orchestrator.ts`
- Test: `sync-job/src/orchestrator.test.ts`

**Interfaces:**
- Consumes: `DataGoKrClient`, `CallBudgetExceededError` (Task 5), `FirestoreRepo` (Task 7), `mapListItem`, `mergeDetailFields`, `VolunteerDoc` (Task 3), `pickDetailFetchTargets` (Task 4), `geocodeAddress` (Task 6).
- Produces: `interface OrchestratorOptions { client: DataGoKrClient; repo: FirestoreRepo; googleMapsApiKey?: string; today?: Date; }`, `async function runSync(options: OrchestratorOptions): Promise<{ pruned: number; sweptPages: number; detailFetched: number }>` — consumed by Task 9's entrypoint.

- [ ] **Step 1: Write the failing tests**

```ts
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
  upserted: (Partial<VolunteerDoc> & { id: string })[] = [];
  deletedExpiredCount = 0;

  async getAllIds() {
    return new Set<string>();
  }
  async getStaleDocs() {
    return [];
  }
  async upsertDoc(doc: Partial<VolunteerDoc> & { id: string }) {
    this.upserted.push(doc);
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
  assert.equal(repo.upserted.length, 1);
  assert.equal(repo.upserted[0].id, '1');
  assert.equal(repo.upserted[0].organization, 'Org 1');
  assert.equal(repo.upserted[0].lat, 37.5);
  assert.equal(repo.upserted[0].spotsNeeded, 5);
  assert.ok(typeof repo.upserted[0].lastDetailFetchAt === 'number');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sync-job && npm test`
Expected: FAIL — `Cannot find module './orchestrator.ts'`

- [ ] **Step 3: Implement `sync-job/src/orchestrator.ts`**

```ts
import { CallBudgetExceededError, DataGoKrClient } from './dataGoKrClient.ts';
import type { FirestoreRepo } from './firestoreRepo.ts';
import { mapListItem, mergeDetailFields, type VolunteerDoc } from './fieldMapping.ts';
import { pickDetailFetchTargets, type StaleDocRef } from './prioritization.ts';
import { geocodeAddress } from './geocode.ts';

export interface OrchestratorOptions {
  client: DataGoKrClient;
  repo: FirestoreRepo;
  googleMapsApiKey?: string;
  today?: Date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function runSync(
  options: OrchestratorOptions
): Promise<{ pruned: number; sweptPages: number; detailFetched: number }> {
  const { client, repo, googleMapsApiKey } = options;
  const today = options.today ?? new Date();

  const pruned = await repo.deleteExpired(toIsoDate(today));

  const existingIds = await repo.getAllIds();
  const newIds: string[] = [];
  const listDocs = new Map<string, Partial<VolunteerDoc>>();
  let sweptPages = 0;
  let totalPages = 1;
  let page = 1;

  try {
    while (page <= totalPages) {
      const { items, totalCount } = await client.fetchListPage(page);
      totalPages = Math.max(1, Math.ceil(totalCount / 100));
      for (const itemXml of items) {
        const doc = mapListItem(itemXml, page, today);
        if (!doc?.id) continue;
        listDocs.set(doc.id, doc);
        await repo.upsertDoc(doc as Partial<VolunteerDoc> & { id: string });
        if (!existingIds.has(doc.id)) newIds.push(doc.id);
      }
      sweptPages += 1;
      page += 1;
    }
  } catch (error) {
    if (!(error instanceof CallBudgetExceededError)) throw error;
  }

  const remainingBudget = client.remainingBudget;
  let detailFetched = 0;

  if (remainingBudget > 0) {
    const staleDocs: StaleDocRef[] = await repo.getStaleDocs(remainingBudget);
    const targets = pickDetailFetchTargets(newIds, staleDocs, remainingBudget);

    for (const id of targets) {
      try {
        const detailXml = await client.fetchDetail(id);
        let merged = mergeDetailFields(listDocs.get(id) ?? { id }, detailXml);

        if ((merged.lat === undefined || merged.lng === undefined) && merged.address && googleMapsApiKey) {
          const coords = await geocodeAddress(merged.address, googleMapsApiKey);
          if (coords) {
            merged = { ...merged, lat: coords.lat, lng: coords.lng };
          }
        }

        await repo.upsertDoc({ ...merged, id, lastDetailFetchAt: Date.now() });
        detailFetched += 1;
      } catch (error) {
        if (error instanceof CallBudgetExceededError) break;
        console.warn(`Failed to detail-fetch ${id}:`, error);
      }
    }
  }

  return { pruned, sweptPages, detailFetched };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sync-job && npm test`
Expected: all tests pass.

- [ ] **Step 5: Type-check**

Run: `cd sync-job && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add sync-job/src/orchestrator.ts sync-job/src/orchestrator.test.ts
git commit -m "feat(sync-job): orchestrate prune, sweep, and budgeted detail-fetch phases"
```

---

## Task 9: Entrypoint, Dockerfile, and local image build

**Files:**
- Create: `sync-job/src/index.ts`
- Create: `sync-job/Dockerfile`

**Interfaces:**
- Consumes: `DataGoKrClient` (Task 5), `FirestoreRepoImpl` (Task 7), `runSync` (Task 8).
- Produces: the container entrypoint used by Task 11's Cloud Run Job.

- [ ] **Step 1: Implement `sync-job/src/index.ts`**

```ts
import { Firestore } from '@google-cloud/firestore';
import { DataGoKrClient } from './dataGoKrClient.ts';
import { FirestoreRepoImpl } from './firestoreRepo.ts';
import { runSync } from './orchestrator.ts';

async function main(): Promise<void> {
  const serviceKey = process.env.DATA_GO_KR_API_KEY;
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!serviceKey) {
    throw new Error('DATA_GO_KR_API_KEY is required');
  }

  const db = new Firestore();
  const repo = new FirestoreRepoImpl(db);
  const client = new DataGoKrClient(serviceKey, 950);

  const result = await runSync({ client, repo, googleMapsApiKey });
  console.log(
    `Sync complete: pruned=${result.pruned} sweptPages=${result.sweptPages} detailFetched=${result.detailFetched} callsMade=${client.callsMade}`
  );
}

main().catch((error) => {
  console.error('Sync job failed:', error);
  process.exit(1);
});
```

- [ ] **Step 2: Implement `sync-job/Dockerfile`**

```dockerfile
FROM node:25-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
CMD ["node", "src/index.ts"]
```

- [ ] **Step 3: Build the image locally to verify it builds**

Run: `cd sync-job && docker build -t volunteer-sync-job:local .`
Expected: build succeeds with no errors.

- [ ] **Step 4: Verify the entrypoint fails fast without credentials (sanity check, not a full run)**

Run: `docker run --rm volunteer-sync-job:local`
Expected: exits non-zero, logging `Sync job failed: Error: DATA_GO_KR_API_KEY is required` — confirms the container starts and the entrypoint's own validation runs.

- [ ] **Step 5: Commit**

```bash
git add sync-job/src/index.ts sync-job/Dockerfile
git commit -m "feat(sync-job): container entrypoint and Dockerfile"
```

---

## Task 10: Terraform — Firestore database and composite index

**Files:**
- Create: `terraform/firestore.tf`

**Interfaces:**
- Produces: a Firestore Native-mode database in `asia-northeast3` and a composite `(lat, lng)` index on `volunteerEvents`, both required by Task 11's job and Task 14's web read path.

- [ ] **Step 1: Implement `terraform/firestore.tf`**

```hcl
resource "google_project_service" "firestore_api" {
  service            = "firestore.googleapis.com"
  disable_on_destroy = false
}

resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  depends_on  = [google_project_service.firestore_api]
}

resource "google_firestore_index" "volunteer_events_geo" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "volunteerEvents"

  fields {
    field_path = "lat"
    order      = "ASCENDING"
  }
  fields {
    field_path = "lng"
    order      = "ASCENDING"
  }
}
```

- [ ] **Step 2: Apply and verify**

Run: `cd terraform && terraform init -input=false && terraform plan -input=false -out=tfplan10 && terraform apply -input=false tfplan10`
Expected: creates `google_firestore_database.default` and `google_firestore_index.volunteer_events_geo`.

Run: `gcloud firestore databases list --project=kr-ai-hackathon26gmp-2258`
Expected: lists a database named `(default)` in `asia-northeast3`, type `FIRESTORE_NATIVE`.

- [ ] **Step 3: Commit**

```bash
cd /Users/mac/personal/volunteer-map-korea
git add terraform/firestore.tf
git commit -m "feat(infra): provision Firestore Native database and lat/lng composite index"
```

---

## Task 11: Terraform — Cloud Run Job for the sync job

**Files:**
- Create: `terraform/sync_job.tf`
- Modify: `terraform/variables.tf`
- Modify: `terraform/terraform.tfvars`
- Modify: `terraform/terraform.tfvars.example`

**Interfaces:**
- Consumes: the already-built `volunteer-sync-job:local` image concept from Task 9 (rebuilt here for a real registry push), the existing `google_artifact_registry_repository.repo` from `terraform/main.tf`.
- Produces: a deployable, manually-triggerable Cloud Run Job named `volunteer-sync-job`.

- [ ] **Step 1: Push an initial sync-job image to Artifact Registry**

Cloud Run Jobs require a valid image to exist at creation time, so the image must be pushed once before Terraform can create the job resource.

Run:
```bash
cd /Users/mac/personal/volunteer-map-korea/sync-job
gcloud auth configure-docker asia-northeast3-docker.pkg.dev --quiet
docker build --platform linux/amd64 -t asia-northeast3-docker.pkg.dev/kr-ai-hackathon26gmp-2258/volunteer-map-repo/volunteer-sync-job:latest .
docker push asia-northeast3-docker.pkg.dev/kr-ai-hackathon26gmp-2258/volunteer-map-repo/volunteer-sync-job:latest
```
Expected: push succeeds.

- [ ] **Step 2: Add the job's service account and IAM to Terraform**

```hcl
resource "google_service_account" "sync_job" {
  account_id   = "volunteer-sync-job"
  display_name = "Volunteer Map sync job"
}

resource "google_project_iam_member" "sync_job_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.sync_job.email}"
}

resource "google_cloud_run_v2_job" "sync_volunteers" {
  name     = "volunteer-sync-job"
  location = var.region

  template {
    template {
      service_account = google_service_account.sync_job.email
      timeout         = "3600s"

      containers {
        image = "${var.region}-docker.pkg.dev/${var.project_id}/volunteer-map-repo/volunteer-sync-job:latest"

        env {
          name  = "DATA_GO_KR_API_KEY"
          value = var.data_go_kr_api_key
        }
        env {
          name  = "GOOGLE_MAPS_API_KEY"
          value = var.google_maps_api_key
        }
      }
    }
  }

  depends_on = [google_firestore_database.default]
}
```

Append this to `terraform/sync_job.tf` (below the Step 1 resources conceptually — write both blocks into the same file).

- [ ] **Step 3: Apply and verify**

Run: `cd terraform && terraform plan -input=false -out=tfplan11 && terraform apply -input=false tfplan11`
Expected: creates the service account, IAM binding, and Cloud Run Job.

Run: `gcloud run jobs execute volunteer-sync-job --region=asia-northeast3 --wait --project=kr-ai-hackathon26gmp-2258`
Expected: job completes successfully (`Execution ... completed successfully`).

Run: `gcloud firestore documents list projects/kr-ai-hackathon26gmp-2258/databases/\(default\)/documents/volunteerEvents --page-size=1 2>&1 | head -20` (or check the GCP Console's Firestore data viewer)
Expected: at least one document exists in `volunteerEvents` with `lat`, `lng`, `organization` fields populated.

- [ ] **Step 4: Commit**

```bash
git add terraform/sync_job.tf terraform/variables.tf terraform/terraform.tfvars terraform/terraform.tfvars.example
git commit -m "feat(infra): Cloud Run Job for the volunteer sync process"
```

---

## Task 12: Terraform — Cloud Scheduler daily trigger

**Files:**
- Create: `terraform/scheduler.tf`

**Interfaces:**
- Consumes: `google_cloud_run_v2_job.sync_volunteers` (Task 11).
- Produces: a daily-firing Cloud Scheduler job that invokes the sync job without any manual step going forward.

- [ ] **Step 1: Implement `terraform/scheduler.tf`**

```hcl
resource "google_project_service" "scheduler_api" {
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "scheduler_invoker" {
  account_id   = "sync-job-scheduler"
  display_name = "Invokes the volunteer sync Cloud Run Job"
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_can_run" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.sync_volunteers.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler_invoker.email}"
}

resource "google_cloud_scheduler_job" "sync_daily" {
  name      = "volunteer-sync-daily"
  region    = var.region
  schedule  = "0 3 * * *"
  time_zone = "Asia/Seoul"

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.sync_volunteers.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler_invoker.email
    }
  }

  depends_on = [google_project_service.scheduler_api, google_cloud_run_v2_job_iam_member.scheduler_can_run]
}
```

- [ ] **Step 2: Apply and verify**

Run: `cd terraform && terraform plan -input=false -out=tfplan12 && terraform apply -input=false tfplan12`
Expected: creates the scheduler job, its invoker service account, and the IAM binding.

Run: `gcloud scheduler jobs describe volunteer-sync-daily --location=asia-northeast3 --project=kr-ai-hackathon26gmp-2258`
Expected: shows schedule `0 3 * * *`, time zone `Asia/Seoul`, state `ENABLED`.

Run: `gcloud scheduler jobs run volunteer-sync-daily --location=asia-northeast3 --project=kr-ai-hackathon26gmp-2258`
Expected: triggers successfully; confirm via `gcloud run jobs executions list --job=volunteer-sync-job --region=asia-northeast3` that a new execution started.

- [ ] **Step 3: Commit**

```bash
git add terraform/scheduler.tf
git commit -m "feat(infra): daily Cloud Scheduler trigger for the sync job"
```

---

## Task 13: Extend cloudbuild.yaml to build and update the sync job

**Files:**
- Modify: `cloudbuild.yaml`

**Interfaces:**
- Consumes: `google_cloud_run_v2_job.sync_volunteers` (Task 11, already exists by this point).
- Produces: future pushes to `main` rebuild and redeploy both the web service and the sync job in one build.

- [ ] **Step 1: Add build/push/update steps for the sync job**

```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-map-web:$COMMIT_SHA', './web']

  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-map-web:$COMMIT_SHA']

  - name: 'gcr.io/cloud-builders/docker'
    args: ['tag', '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-map-web:$COMMIT_SHA', '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-map-web:latest']

  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-map-web:latest']

  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-sync-job:$COMMIT_SHA', './sync-job']

  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-sync-job:$COMMIT_SHA']

  - name: 'gcr.io/cloud-builders/docker'
    args: ['tag', '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-sync-job:$COMMIT_SHA', '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-sync-job:latest']

  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-sync-job:latest']

  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'volunteer-map-service'
      - '--image'
      - '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-map-web:latest'
      - '--region'
      - '${_REGION}'

  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'jobs'
      - 'update'
      - 'volunteer-sync-job'
      - '--image'
      - '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-sync-job:latest'
      - '--region'
      - '${_REGION}'

substitutions:
  _REGION: 'asia-northeast3'

images:
  - '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-map-web:$COMMIT_SHA'
  - '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-map-web:latest'
  - '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-sync-job:$COMMIT_SHA'
  - '${_REGION}-docker.pkg.dev/$PROJECT_ID/volunteer-map-repo/volunteer-sync-job:latest'
```

- [ ] **Step 2: Verify the build config is syntactically valid**

Run: `cd /Users/mac/personal/volunteer-map-korea && gcloud builds submit --config cloudbuild.yaml --substitutions=COMMIT_SHA=$(git rev-parse HEAD) --project=kr-ai-hackathon26gmp-2258 --no-source 2>&1 | head -5` is not applicable without source; instead validate structurally:

Run: `python3 -c "import yaml; yaml.safe_load(open('cloudbuild.yaml'))" && echo "valid YAML"`
Expected: `valid YAML`. The full build is exercised for real in Task 15's redeploy step.

- [ ] **Step 3: Commit**

```bash
git add cloudbuild.yaml
git commit -m "feat(infra): build and deploy the sync job alongside the web service"
```

---

## Task 14: Web — shared event type and Firestore viewport query

**Files:**
- Create: `web/src/types/volunteerEvent.ts`
- Create: `web/src/lib/firestoreClient.ts`
- Create: `web/src/lib/firestoreEvents.ts`
- Test: `web/src/lib/firestoreEvents.test.ts`
- Modify: `web/package.json`

**Interfaces:**
- Produces: `interface VolunteerEvent` (shared client/server shape), `parseBoundingBox(searchParams: URLSearchParams): BoundingBox | null`, `queryEventsInBounds(bbox: BoundingBox): Promise<VolunteerEvent[]>` — consumed by Task 15's route handler and Task 17/18's `MapComponent.tsx`.

- [ ] **Step 1: Add the Firestore dependency, ESM mode, and a test runner script**

Edit `web/package.json`:
- Add `"@google-cloud/firestore": "^7.11.0"` to `dependencies`.
- Add `"type": "module"` at the top level. Without it, `node --test` prints a `MODULE_TYPELESS_PACKAGE_JSON` warning on every `.test.ts` file (confirmed empirically) — noisy but not fatal; Next.js's own build/dev pipeline is unaffected by this field since it uses its own transpilation regardless.
- Add to `scripts`: `"test": "node --test"`. Passing no path argument is required — passing a directory (e.g. `node --test src`) does NOT recursively discover tests and fails outright (confirmed empirically); only the bare, argument-less form's default recursive discovery finds nested files like Task 16's `web/src/lib/weekday.test.ts`.

- [ ] **Step 2: Create the shared type**

```ts
export interface VolunteerEvent {
  id: string;
  title: string;
  translatedTitle?: string;
  organization?: string;
  category?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  recruitStartDate?: string;
  recruitEndDate?: string;
  externalUrl?: string;
  description?: string;
  spotsNeeded?: number;
  spotsFilled?: number;
  adultPosblAt?: string;
  familyPosblAt?: string;
  grpPosblAt?: string;
  pbsvntPosblAt?: string;
  yngbgsPosblAt?: string;
  actWkdy?: string;
  email?: string;
  telno?: string;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
}
```

- [ ] **Step 3: Write the failing test for bounding-box parsing**

```ts
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd web && npm test`
Expected: FAIL — `Cannot find module './firestoreEvents.ts'`

- [ ] **Step 5: Create `web/src/lib/firestoreClient.ts`**

```ts
import { Firestore } from '@google-cloud/firestore';

let instance: Firestore | null = null;

export function getFirestoreClient(): Firestore {
  if (!instance) {
    instance = new Firestore();
  }
  return instance;
}
```

- [ ] **Step 6: Implement `web/src/lib/firestoreEvents.ts`**

```ts
import type { Firestore } from '@google-cloud/firestore';
import { getFirestoreClient } from './firestoreClient.ts';
import type { VolunteerEvent } from '../types/volunteerEvent.ts';

export interface BoundingBox {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

export function parseBoundingBox(searchParams: URLSearchParams): BoundingBox | null {
  const raw = {
    swLat: searchParams.get('swLat'),
    swLng: searchParams.get('swLng'),
    neLat: searchParams.get('neLat'),
    neLng: searchParams.get('neLng'),
  };
  if (!raw.swLat || !raw.swLng || !raw.neLat || !raw.neLng) return null;

  const parsed = {
    swLat: parseFloat(raw.swLat),
    swLng: parseFloat(raw.swLng),
    neLat: parseFloat(raw.neLat),
    neLng: parseFloat(raw.neLng),
  };
  if (Object.values(parsed).some((n) => isNaN(n))) return null;
  return parsed;
}

export async function queryEventsInBounds(bbox: BoundingBox, db: Firestore = getFirestoreClient()): Promise<VolunteerEvent[]> {
  const snapshot = await db
    .collection('volunteerEvents')
    .where('lat', '>=', bbox.swLat)
    .where('lat', '<=', bbox.neLat)
    .where('lng', '>=', bbox.swLng)
    .where('lng', '<=', bbox.neLng)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      title: data.title,
      organization: data.organization,
      category: data.category,
      status: data.status,
      startDate: data.startDate,
      endDate: data.endDate,
      startTime: data.startTime,
      endTime: data.endTime,
      recruitStartDate: data.recruitStartDate,
      recruitEndDate: data.recruitEndDate,
      externalUrl: data.externalUrl,
      description: data.description,
      spotsNeeded: data.spotsNeeded,
      spotsFilled: data.spotsFilled,
      adultPosblAt: data.adultPosblAt,
      familyPosblAt: data.familyPosblAt,
      grpPosblAt: data.grpPosblAt,
      pbsvntPosblAt: data.pbsvntPosblAt,
      yngbgsPosblAt: data.yngbgsPosblAt,
      actWkdy: data.actWkdy,
      email: data.email,
      telno: data.telno,
      location:
        typeof data.lat === 'number' && typeof data.lng === 'number'
          ? { lat: data.lat, lng: data.lng, address: data.address }
          : undefined,
    };
  });
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd web && npm install && npm test`
Expected: the 3 `parseBoundingBox` tests pass. (`queryEventsInBounds` has no unit test — it is a thin Firestore query with no branching logic, matching the pattern used for `firestoreRepo.ts` in Task 7; it is verified against real data in Task 15.)

- [ ] **Step 8: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add web/package.json web/package-lock.json web/src/types/volunteerEvent.ts web/src/lib/firestoreClient.ts web/src/lib/firestoreEvents.ts web/src/lib/firestoreEvents.test.ts
git commit -m "feat(web): shared event type and Firestore viewport query"
```

---

## Task 15: Web — rewrite /api/volunteers and update IAM/env vars

**Files:**
- Modify: `web/src/app/api/volunteers/route.ts`
- Modify: `terraform/main.tf`
- Modify: `terraform/variables.tf`

**Interfaces:**
- Consumes: `parseBoundingBox`, `queryEventsInBounds` from `web/src/lib/firestoreEvents.ts` (Task 14).

- [ ] **Step 1: Replace `web/src/app/api/volunteers/route.ts` entirely**

```ts
import { NextResponse } from 'next/server';
import mockData from '@/data/seoul_volunteers.json';
import { parseBoundingBox, queryEventsInBounds } from '@/lib/firestoreEvents';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bbox = parseBoundingBox(searchParams);

  if (!bbox) {
    return NextResponse.json({ error: 'swLat, swLng, neLat, neLng query params are required' }, { status: 400 });
  }

  try {
    const events = await queryEventsInBounds(bbox);
    return NextResponse.json({ events });
  } catch (error) {
    console.error('Firestore query failed. Falling back to mock data. Error:', error);
    return NextResponse.json(mockData);
  }
}
```

- [ ] **Step 2: Remove the now-unused data.go.kr/geocoding env vars from the web Cloud Run service**

In `terraform/main.tf`, inside `google_cloud_run_v2_service.default`'s `containers` block, delete these two blocks (they move to `terraform/sync_job.tf`, already added in Task 11):

```hcl
      env {
        name  = "DATA_GO_KR_API_KEY"
        value = var.data_go_kr_api_key
      }
```
and
```hcl
      env {
        name  = "GOOGLE_MAPS_API_KEY"
        value = var.google_maps_api_key
      }
```

Add Firestore read access for the web service's Cloud Run service account. Find the service account the web service currently runs as (the Cloud Run default compute service account, since `main.tf` never set a custom one):

```bash
gcloud iam service-accounts list --project=kr-ai-hackathon26gmp-2258 --filter="email:compute@developer.gserviceaccount.com" --format="value(email)"
```

Add to `terraform/main.tf`:

```hcl
resource "google_project_iam_member" "web_firestore_reader" {
  project = var.project_id
  role    = "roles/datastore.viewer"
  member  = "serviceAccount:${data.google_compute_default_service_account.default.email}"
}

data "google_compute_default_service_account" "default" {
  project = var.project_id
}
```

- [ ] **Step 3: Apply Terraform and rebuild/redeploy the web service**

Run: `cd terraform && terraform plan -input=false -out=tfplan15 && terraform apply -input=false tfplan15`
Expected: removes the two env vars from the web service, adds the `datastore.viewer` IAM binding.

Run:
```bash
cd /Users/mac/personal/volunteer-map-korea
SHA=$(git rev-parse HEAD)
gcloud builds submit --config cloudbuild.yaml --substitutions=COMMIT_SHA="$SHA" --project=kr-ai-hackathon26gmp-2258 .
```
Expected: both the web service and sync job images rebuild and deploy successfully.

- [ ] **Step 4: Verify against real data**

Run: `curl -s "https://volunteer-map-service-ta2zjihc7a-du.a.run.app/api/volunteers?swLat=37.4&swLng=126.8&neLat=37.7&neLng=127.2" | python3 -m json.tool | head -30`
Expected: returns `events` populated from Firestore (from Task 11's sync run), each with `lat`/`lng` inside the requested bounds.

Run: `curl -s "https://volunteer-map-service-ta2zjihc7a-du.a.run.app/api/volunteers" -o /dev/null -w "%{http_code}\n"`
Expected: `400` (missing bounding-box params).

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/volunteers/route.ts terraform/main.tf
git commit -m "feat(web): serve /api/volunteers from Firestore viewport queries instead of live data.go.kr calls"
```

---

## Task 16: Weekday schedule decoder

**Files:**
- Create: `web/src/lib/weekday.ts`
- Test: `web/src/lib/weekday.test.ts`

**Interfaces:**
- Produces: `decodeWeekdays(bitmap: string | undefined, language: 'en' | 'ko'): string | undefined` — consumed by Task 18's `MapComponent.tsx`.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test`
Expected: FAIL — `Cannot find module './weekday.ts'`

- [ ] **Step 3: Implement `web/src/lib/weekday.ts`**

```ts
const DAY_LABELS: Record<'en' | 'ko', string[]> = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  ko: ['월', '화', '수', '목', '금', '토', '일'],
};

function collapseRanges(indices: number[], labels: string[]): string[] {
  const groups: string[] = [];
  let start = indices[0];
  let prev = indices[0];

  for (let i = 1; i <= indices.length; i++) {
    const current = indices[i];
    if (current !== prev + 1) {
      groups.push(start === prev ? labels[start] : `${labels[start]}-${labels[prev]}`);
      start = current;
    }
    prev = current;
  }
  return groups;
}

export function decodeWeekdays(bitmap: string | undefined, language: 'en' | 'ko'): string | undefined {
  if (!bitmap || bitmap.length !== 7 || !/^[01]{7}$/.test(bitmap)) return undefined;

  const labels = DAY_LABELS[language];
  const activeIndices = bitmap.split('').map((c, i) => (c === '1' ? i : -1)).filter((i) => i !== -1);

  if (activeIndices.length === 0) return undefined;
  if (activeIndices.length === 7) return language === 'en' ? 'Every day' : '매일';

  return collapseRanges(activeIndices, labels).join(', ');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/weekday.ts web/src/lib/weekday.test.ts
git commit -m "feat(web): decode actWkdy bitmap into a readable weekday schedule"
```

---

## Task 17: Viewport-based fetching and zoom cutoff

**Files:**
- Modify: `web/src/components/MapComponent.tsx`

**Interfaces:**
- Consumes: `VolunteerEvent` now imported from `@/types/volunteerEvent` (Task 14) instead of the local inline interface.

- [ ] **Step 1: Replace the local `VolunteerEvent` interface with the shared import**

At the top of `web/src/components/MapComponent.tsx`, replace:

```ts
interface VolunteerEvent {
  id: string;
  title: string;
  translatedTitle?: string;
  organization?: string;
  category?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  recruitStartDate?: string;
  recruitEndDate?: string;
  externalUrl?: string;
  description?: string;
  spotsNeeded?: number;
  spotsFilled?: number;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
}
```

with:

```ts
import type { VolunteerEvent } from '@/types/volunteerEvent';
```

(placed alongside the existing `import { useEffect, useRef, useState } from 'react';` at the top of the file).

- [ ] **Step 2: Replace the mount-time fetch with a viewport-driven, debounced fetch, and add the zoom cutoff**

Replace the entire `buildMap`/marker-rendering block inside the first `useEffect` (from `const buildMap = () => {` through the closing of the `.catch` call, i.e. lines 172-248 of the pre-change file) with:

```ts
    const ZOOM_CUTOFF_LEVEL = 9; // Kakao's 1-14 scale; below city/metro zoom, don't query or render pins.
    const markerById = new Map<string, { marker: kakao.maps.CustomOverlay; event: VolunteerEvent }>();
    let debounceTimer: NodeJS.Timeout;

    const clearAllMarkers = () => {
      markerById.forEach(({ marker }) => marker.setMap(null));
      markerById.clear();
      markersRef.current = [];
    };

    const renderEvents = (fetchedEvents: VolunteerEvent[], currentMap: kakao.maps.Map) => {
      clearAllMarkers();
      setEvents(fetchedEvents);
      fetchedEvents.forEach((event) => {
        if (
          !event.location ||
          typeof event.location.lat !== 'number' || isNaN(event.location.lat) ||
          typeof event.location.lng !== 'number' || isNaN(event.location.lng)
        ) {
          return;
        }

        const pinContainer = document.createElement('div');
        pinContainer.className = 'custom-map-pin';
        pinContainer.title = event.translatedTitle || event.title;
        const groupStyle = GROUP_STYLES[getCategoryGroup(event.category)];
        const pinColor = groupStyle.color;
        pinContainer.style.setProperty('--pin-color', pinColor);

        const svgIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">${groupStyle.icon}</svg>`;

        pinContainer.innerHTML = `
          <div class="pin-pulse" style="background-color: ${pinColor}"></div>
          <div class="pin-core" style="background-color: ${pinColor}">
            ${svgIcon}
          </div>
        `;

        const marker = new kakao.maps.CustomOverlay({
          map: (hideFullRef.current && isFull(event)) ? null : currentMap,
          position: new kakao.maps.LatLng(event.location.lat, event.location.lng),
          content: pinContainer,
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex: 1,
        });

        markerById.set(event.id, { marker, event });
        markersRef.current.push({ marker, event });

        pinContainer.addEventListener('click', () => {
          setSelectedEvent(event);
          setShareStatus('idle');
          setClickedCount((prev) => prev + 1);
        });
      });
    };

    const fetchViewport = (currentMap: kakao.maps.Map) => {
      if (currentMap.getLevel() >= ZOOM_CUTOFF_LEVEL) {
        clearAllMarkers();
        setEvents([]);
        return;
      }

      const bounds = currentMap.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const params = new URLSearchParams({
        swLat: String(sw.getLat()),
        swLng: String(sw.getLng()),
        neLat: String(ne.getLat()),
        neLng: String(ne.getLng()),
      });

      fetch(`/api/volunteers?${params.toString()}`)
        .then((res) => res.json())
        .then((data) => {
          if (!active) return;
          if (data && Array.isArray(data.events)) {
            renderEvents(data.events, currentMap);
          }
        })
        .catch((err) => {
          if (!active) return;
          console.error('Failed to fetch volunteer data:', err);
        });
    };

    const buildMap = () => {
      if (!active || !mapRef.current || mapInitialized.current) return;

      const newMap = new kakao.maps.Map(mapRef.current, {
        center: new kakao.maps.LatLng(37.5665, 126.9780),
        level: 7,
      });
      setMap(newMap);
      mapInitialized.current = true;

      kakao.maps.event.addListener(newMap, 'idle', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchViewport(newMap), 400);
      });

      fetchViewport(newMap);

      // If this page was opened via a shared link (?event=<id>), fetch that
      // one event directly (its own tight bounding box) so it's shown even
      // if it falls outside the default Seoul-centered viewport.
      const sharedId = new URLSearchParams(window.location.search).get('event');
      if (sharedId) {
        fetch(`/api/volunteers?swLat=33&swLng=124&neLat=39&neLng=132`)
          .then((res) => res.json())
          .then((data) => {
            if (!active || !Array.isArray(data?.events)) return;
            const sharedEvent = data.events.find((e: VolunteerEvent) => e.id === sharedId);
            if (sharedEvent?.location) {
              setSelectedEvent(sharedEvent);
              newMap.setCenter(new kakao.maps.LatLng(sharedEvent.location.lat, sharedEvent.location.lng));
              newMap.setLevel(3);
              hasCenteredOnUser.current = true;
            }
          })
          .catch((err) => console.error('Failed to fetch shared event:', err));
      }
    };
```

Note: the shared-link fetch uses the whole-of-South-Korea bounding box (`swLat=33&swLng=124&neLat=39&neLng=132`, matching the existing coordinate sanity-check range in `parseAreaLalo`) specifically because a shared event might be outside the default Seoul-centered viewport.

- [ ] **Step 3: Update the cleanup function to use `clearAllMarkers`**

Replace the existing cleanup block:

```ts
    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
      mapInitialized.current = false; // Reset to support Strict Mode remounts
      markersRef.current.forEach(({ marker }) => {
        marker.setMap(null);
      });
      markersRef.current = [];
    };
```

with:

```ts
    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
      clearTimeout(debounceTimer);
      mapInitialized.current = false; // Reset to support Strict Mode remounts
      clearAllMarkers();
    };
```

- [ ] **Step 4: Add the "zoom in" prompt to the JSX**

In the returned JSX, immediately after the `<div ref={mapRef} .../>` line, add:

```tsx
      {map && map.getLevel() >= 9 && (
        <div className="zoom-prompt">
          {language === 'ko' ? '자원봉사 활동을 보려면 확대하세요' : 'Zoom in to see volunteer opportunities'}
        </div>
      )}
```

- [ ] **Step 5: Add the `.zoom-prompt` style to `web/src/app/globals.css`**

```css
.zoom-prompt {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(255, 255, 255, 0.9);
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 999;
  pointer-events: none;
}

@media (prefers-color-scheme: dark) {
  .zoom-prompt {
    background: rgba(30, 30, 30, 0.9);
    color: #e2e8f0;
  }
}
```

- [ ] **Step 6: Type-check and build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: no type errors, build succeeds.

- [ ] **Step 7: Verify viewport fetching and the zoom cutoff with Playwright**

Write a throwaway script to the scratchpad and run it — do not commit this script.

```js
// /private/tmp/claude-501/-Users-mac-personal/069f513e-1dd6-49eb-accf-5d6ea1b7d73e/scratchpad/verify_viewport.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const requests = [];
page.on('request', (req) => {
  if (req.url().includes('/api/volunteers')) requests.push(req.url());
});

await page.goto('http://localhost:3000');
await page.waitForTimeout(2000);
console.log('Initial fetch count:', requests.length);

await page.mouse.wheel(0, -500); // zoom in
await page.waitForTimeout(1000);
await page.mouse.move(400, 300);
await page.mouse.wheel(0, -500);
await page.waitForTimeout(1000);
console.log('After zoom/pan, fetch count:', requests.length);
console.log('Last request:', requests[requests.length - 1]);

// Zoom out past the cutoff repeatedly and check for the prompt.
for (let i = 0; i < 10; i++) {
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(200);
}
await page.waitForTimeout(1000);
const promptVisible = await page.locator('.zoom-prompt').isVisible().catch(() => false);
console.log('Zoom-out prompt visible:', promptVisible);

await browser.close();
```

Run: `node /private/tmp/claude-501/-Users-mac-personal/069f513e-1dd6-49eb-accf-5d6ea1b7d73e/scratchpad/verify_viewport.mjs` (with `npm run dev` already running against `web/` in another terminal)
Expected: fetch count increases after zoom/pan (a new request with different `swLat`/`neLat` params), and `promptVisible` is `true` after zooming out past level 9.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/MapComponent.tsx web/src/app/globals.css
git commit -m "feat(web): viewport-based debounced fetching with a zoom-out cutoff"
```

---

## Task 18: Card UI — eligibility badges, weekday schedule, contact info

**Files:**
- Modify: `web/src/components/MapComponent.tsx`
- Modify: `web/src/app/globals.css`

**Interfaces:**
- Consumes: `decodeWeekdays` from `@/lib/weekday` (Task 16).

- [ ] **Step 1: Import the decoder**

Add near the top of `web/src/components/MapComponent.tsx`:

```ts
import { decodeWeekdays } from '@/lib/weekday';
```

- [ ] **Step 2: Add eligibility-badge and weekday-schedule labels to `UI_TEXT`**

Add these keys to both the `en` and `ko` objects in `UI_TEXT`:

```ts
    familyOk: 'Family OK',
    groupOk: 'Group OK',
    youthOk: 'Youth OK',
    adultsOnly: 'Adults Only',
    schedule: 'Schedule:',
    contact: 'Contact:',
```
(Korean equivalents: `가족 참여 가능`, `단체 참여 가능`, `청소년 참여 가능`, `성인만 가능`, `활동 요일:`, `연락처:`)

- [ ] **Step 3: Render eligibility badges in the card, only for flags that are `Y`**

In the card JSX, immediately after the category/distance row (`</div>` that closes the row containing `getDistanceKm`), add:

```tsx
            {(selectedEvent.familyPosblAt === 'Y' || selectedEvent.grpPosblAt === 'Y' || selectedEvent.pbsvntPosblAt === 'Y' || (selectedEvent.adultPosblAt === 'Y' && selectedEvent.yngbgsPosblAt !== 'Y')) && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '4px 0 8px 0' }}>
                {selectedEvent.familyPosblAt === 'Y' && <span className="eligibility-badge">{UI_TEXT[language].familyOk}</span>}
                {selectedEvent.grpPosblAt === 'Y' && <span className="eligibility-badge">{UI_TEXT[language].groupOk}</span>}
                {selectedEvent.pbsvntPosblAt === 'Y' && <span className="eligibility-badge">{UI_TEXT[language].youthOk}</span>}
                {selectedEvent.adultPosblAt === 'Y' && selectedEvent.yngbgsPosblAt !== 'Y' && (
                  <span className="eligibility-badge">{UI_TEXT[language].adultsOnly}</span>
                )}
              </div>
            )}
```

- [ ] **Step 4: Render the weekday schedule, only when decodable**

Immediately after the existing "daily time" row (the block checking `selectedEvent.startTime || selectedEvent.endTime`), add:

```tsx
            {decodeWeekdays(selectedEvent.actWkdy, language) && (
              <div style={{ fontSize: '14px', margin: '4px 0', color: '#475569' }}>
                <strong>{UI_TEXT[language].schedule}</strong> {decodeWeekdays(selectedEvent.actWkdy, language)}
              </div>
            )}
```

- [ ] **Step 5: Render contact info, only when present**

Immediately before the `card-actions` div, add:

```tsx
            {(selectedEvent.email || selectedEvent.telno) && (
              <div style={{ fontSize: '14px', margin: '4px 0 8px 0', color: '#475569' }}>
                <strong>{UI_TEXT[language].contact}</strong>{' '}
                {selectedEvent.telno && <a href={`tel:${selectedEvent.telno}`}>{selectedEvent.telno}</a>}
                {selectedEvent.telno && selectedEvent.email && ' · '}
                {selectedEvent.email && <a href={`mailto:${selectedEvent.email}`}>{selectedEvent.email}</a>}
              </div>
            )}
```

- [ ] **Step 6: Add the `.eligibility-badge` style to `web/src/app/globals.css`**

```css
.eligibility-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2ff;
  color: #3730a3;
  font-size: 11px;
  font-weight: 600;
}

@media (prefers-color-scheme: dark) {
  .eligibility-badge {
    background: #312e81;
    color: #e0e7ff;
  }
}
```

- [ ] **Step 7: Type-check and build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: no type errors, build succeeds.

- [ ] **Step 8: Verify with Playwright, injecting a synthetic API response with the new fields**

```js
// /private/tmp/claude-501/-Users-mac-personal/069f513e-1dd6-49eb-accf-5d6ea1b7d73e/scratchpad/verify_card_fields.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

await page.route('**/api/volunteers*', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      events: [{
        id: 'test-1',
        title: 'Test Event',
        category: 'Education',
        familyPosblAt: 'Y',
        grpPosblAt: 'N',
        pbsvntPosblAt: 'N',
        adultPosblAt: 'Y',
        yngbgsPosblAt: 'N',
        actWkdy: '1111100',
        email: 'test@example.com',
        telno: '02-1234-5678',
        location: { lat: 37.5665, lng: 126.9780, address: 'Seoul' },
      }],
    }),
  })
);

await page.goto('http://localhost:3000');
await page.waitForTimeout(2000);
await page.locator('.custom-map-pin').first().click();
await page.waitForTimeout(500);

const badges = await page.locator('.eligibility-badge').allTextContents();
console.log('Badges shown:', badges);
const scheduleText = await page.locator('text=Mon-Fri').isVisible().catch(() => false);
console.log('Schedule shown:', scheduleText);
const contactLink = await page.locator('a[href="tel:02-1234-5678"]').isVisible().catch(() => false);
console.log('Contact link shown:', contactLink);

await browser.close();
```

Run: `node /private/tmp/claude-501/-Users-mac-personal/069f513e-1dd6-49eb-accf-5d6ea1b7d73e/scratchpad/verify_card_fields.mjs`
Expected: `Badges shown: [ 'Family OK', 'Adults Only' ]` (the fixture has `familyPosblAt: 'Y'` and `adultPosblAt: 'Y'` with `yngbgsPosblAt: 'N'`; `grpPosblAt`/`pbsvntPosblAt` are `'N'` so those two badges are correctly absent), `Schedule shown: true`, `Contact link shown: true`.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/MapComponent.tsx web/src/app/globals.css
git commit -m "feat(web): show eligibility badges, weekday schedule, and contact info on the event card"
```

---

## Task 19: Final end-to-end verification and deploy

**Files:** none (verification only)

- [ ] **Step 1: Full local build check**

Run: `cd web && npm run build`
Expected: builds cleanly.

- [ ] **Step 2: Deploy the final state**

Run:
```bash
cd /Users/mac/personal/volunteer-map-korea
SHA=$(git rev-parse HEAD)
gcloud builds submit --config cloudbuild.yaml --substitutions=COMMIT_SHA="$SHA" --project=kr-ai-hackathon26gmp-2258 .
```
Expected: both images build and deploy successfully.

- [ ] **Step 3: End-to-end production check**

Run:
```bash
curl -s "https://volunteer-map-service-ta2zjihc7a-du.a.run.app/api/volunteers?swLat=37.4&swLng=126.8&neLat=37.7&neLng=127.2" | python3 -c "import json,sys; d=json.load(sys.stdin); print('event count:', len(d.get('events', [])))"
```
Expected: a nonzero count of events sourced from Firestore, within the requested bounds.

- [ ] **Step 4: Confirm the scheduler and job are both healthy**

Run: `gcloud scheduler jobs describe volunteer-sync-daily --location=asia-northeast3 --project=kr-ai-hackathon26gmp-2258 --format="value(state)"`
Expected: `ENABLED`.

Run: `gcloud run jobs executions list --job=volunteer-sync-job --region=asia-northeast3 --project=kr-ai-hackathon26gmp-2258 --limit=1 --format="value(status.conditions[0].type,status.conditions[0].state)"`
Expected: shows the most recent execution completed successfully.

No commit for this task — it is verification of work already committed in Tasks 1-18.
