import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const html = await readFile(
  new URL('../admin-scout.html', import.meta.url),
  'utf8'
);

test('SCOUT beta analytics page is admin-only, noindexed and uses the protected server endpoint', () => {
  assert.match(html, /noindex,nofollow,noarchive/);
  assert.match(html, /SCOUT β ANALYTICS/);
  assert.match(html, /\/api\/admin-scout-analytics/);
  assert.match(html, /Authorization:`Bearer \$\{session\.access_token\}`/);
  assert.match(html, /admin\.html/);
  assert.match(
    html,
    /SCOUT Level \/ Rank \/ XPはβユーザー画面には表示しません/
  );
});

test('SCOUT beta analytics page covers the MASTER-required beta analysis surfaces', () => {
  assert.match(html, /生涯EXPヒストグラム/);
  assert.match(html, /獲得源別構成/);
  assert.match(html, /0個使用率/);
  assert.match(html, /11個完全消化率/);
  assert.match(html, /SEED種類別 発掘成功率/);
  assert.match(html, /送信時Rank別 到達率/);
  assert.match(html, /ユーザー別SCOUT活動/);
});
