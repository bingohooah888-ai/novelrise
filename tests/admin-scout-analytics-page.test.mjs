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
  assert.match(html, /β版SCOUT RECORDの利用率・Level分布・Scout Point・称号/);
});

test('SCOUT beta analytics page covers the MASTER-required beta analysis surfaces', () => {
  assert.match(html, /生涯EXPヒストグラム/);
  assert.match(html, /獲得源別構成/);
  assert.match(html, /0個使用率/);
  assert.match(html, /11個完全消化率/);
  assert.match(html, /SEED種類別 発掘成功率/);
  assert.match(html, /送信時Rank別 到達率/);
  assert.match(html, /発掘成功後の平均最高成長/);
  assert.match(html, /発掘成功後 \+3以上到達率/);
  assert.match(html, /発掘成功後 \+4 \/ \+5到達率/);
  assert.match(html, /ユーザー別SCOUT活動/);
  assert.match(html, /SCOUT RECORD KPI/);
  assert.match(html, /SCOUT RECORD利用率/);
  assert.match(html, /Lv\.30到達率/);
  assert.match(html, /Scout Point発行量/);
  assert.match(html, /称号獲得数/);
  assert.match(html, /Scout Level分布/);
  assert.match(html, /Scout Point発行理由/);
  assert.match(html, /称号別獲得率/);
  assert.match(html, /SCOUT利用者 7日継続率/);
  assert.match(html, /非利用者 7日継続率/);
  assert.match(html, /SCOUT利用者 30日継続率/);
  assert.match(html, /非利用者 30日継続率/);
  assert.match(html, /SCOUT利用者 1読者あたり有効閲覧作品/);
  assert.match(html, /非利用者 1読者あたり有効閲覧作品/);
  assert.match(html, /SCOUT利用者 新規作者 \/ 低Rank流入/);
  assert.match(html, /非利用者 新規作者 \/ 低Rank流入/);
  assert.match(html, /獲得者率/);
  assert.match(html, /P90/);
  assert.match(html, /Point獲得停止/);
  assert.match(html, /直近Point Ledger \/ 運営操作/);
});
