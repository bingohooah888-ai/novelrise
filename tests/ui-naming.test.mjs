import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);

async function rootHtmlFiles() {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => entry.name)
    .sort();
}

test('user-facing HTML uses the current NOVELIGHT feature names', async () => {
  const files = await rootHtmlFiles();
  const violations = [];

  for (const file of files) {
    const html = await readFile(join(root.pathname, file), 'utf8');

    for (const forbidden of ['目利き', '目利き実績', '目利きレベル', '新作48時間初動ブースト']) {
      if (html.includes(forbidden)) violations.push(`${file}: ${forbidden}`);
    }

    const nonCanonicalExposure = html.match(/(?<!プランによる)追加露出/g);
    if (nonCanonicalExposure) {
      violations.push(`${file}: canonicalize ${nonCanonicalExposure.length} occurrence(s) of 追加露出`);
    }
  }

  assert.deepEqual(violations, []);
});

test('core pages expose the approved beta names and SCOUT RECORD route', async () => {
  const [novel, analytics, mypage, pricing, scoutRecord] = await Promise.all([
    readFile(join(root.pathname, 'novel.html'), 'utf8'),
    readFile(join(root.pathname, 'analytics.html'), 'utf8'),
    readFile(join(root.pathname, 'mypage.html'), 'utf8'),
    readFile(join(root.pathname, 'pricing.html'), 'utf8'),
    readFile(join(root.pathname, 'scout-record.html'), 'utf8')
  ]);

  assert.match(novel, /LIGHT SEEDを贈る/);
  assert.match(analytics, /LIGHT ANALYTICS/);
  assert.match(mypage, /作者ホーム/);
  assert.match(mypage, /SCOUT RECORD/);
  assert.match(pricing, /新作48時間ブースト/);
  assert.match(pricing, /プランによる追加露出/);
  assert.match(scoutRecord, /SCOUT RECORD/);
  assert.match(scoutRecord, /from\('light_seeds'\)/);
});
