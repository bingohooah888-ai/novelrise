import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const mypage = await readFile(new URL('../mypage.html', import.meta.url), 'utf8');
const scout = await readFile(new URL('../scout-record.html', import.meta.url), 'utf8');
const history = await readFile(new URL('../light-seed-history.html', import.meta.url), 'utf8');

test('beta navigation links to the live SCOUT RECORD surface', () => {
  assert.match(
    mypage,
    /href="scout-record\.html"[^>]*><span class="nav-icon">◇<\/span><span>SCOUT RECORD<\/span>/u
  );
  assert.match(
    mypage,
    /<h2>LIGHT SEED送信履歴<\/h2>[\s\S]*?href="light-seed-history\.html">履歴を見る →<\/a>/u
  );
});

test('beta SCOUT RECORD loads owner-only progression through RPCs', () => {
  assert.match(scout, /<title>SCOUT RECORD \| NOVELIGHT<\/title>/u);
  assert.match(scout, /<h1 id="scoutTitle">SCOUT RECORD<\/h1>/u);
  assert.match(scout, /BETA \/ DISCOVERY RECORD/u);
  assert.match(scout, /novelight_scout_record_summary/u);
  assert.match(scout, /novelight_scout_point_history/u);
  assert.match(scout, /novelight_scout_recent_activity/u);
  assert.match(scout, /novelight_scout_discoveries/u);
  assert.match(scout, /login\.html\?redirect=scout-record\.html/u);
  assert.match(scout, /β LEVEL MAX/u);
  assert.match(scout, /Lv\.30到達後に獲得条件を満たしたXPは蓄積されず消滅/u);
  assert.match(scout, /AI利用特典への交換機能を予定/u);

  assert.doesNotMatch(scout, /LOCKED PREVIEW/u);
  assert.doesNotMatch(scout, /正式リリース時解放/u);
  assert.doesNotMatch(scout, /\.from\(['"]scout_/u);
  assert.doesNotMatch(scout, /\.from\(['"]seed_discovery_state/u);
  assert.doesNotMatch(scout, /\.from\(['"]novel_rank_state/u);
});

test('LIGHT SEED history remains separate but links back to live SCOUT RECORD', () => {
  assert.match(history, /<title>LIGHT SEED送信履歴 \| NOVELIGHT<\/title>/u);
  assert.match(history, /<h1>LIGHT SEED送信履歴<\/h1>/u);
  assert.match(history, /client\.from\('light_seeds'\)/u);
  assert.match(history, /login\.html\?redirect=light-seed-history\.html/u);
  assert.match(history, /href="scout-record\.html">SCOUT RECORDを見る →<\/a>/u);
  assert.doesNotMatch(history, /SCOUT RECORD βプレビューを見る/u);
});
