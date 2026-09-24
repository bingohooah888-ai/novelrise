import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styles = await readFile('novelight-scout-record.css', 'utf8');
const scope = 'body.novelight-page-scout-record ';
const start = styles.indexOf(`${scope}.badge-icon-artwork{`);
const end = styles.indexOf('\n}', start);
const rule = styles.slice(start, end);

test('Reader Easy artwork keeps its sprite background image', () => {
  assert.ok(start >= 0);
  assert.ok(end > start);
  assert.equal(rule.includes('\n  background:'), false);
  assert.ok(rule.includes('background-color:transparent!important'));
  assert.ok(styles.includes('scout-reader-easy-badges.webp'));
});
