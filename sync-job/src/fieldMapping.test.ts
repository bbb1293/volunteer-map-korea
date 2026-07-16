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
