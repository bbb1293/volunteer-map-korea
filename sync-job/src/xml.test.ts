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
