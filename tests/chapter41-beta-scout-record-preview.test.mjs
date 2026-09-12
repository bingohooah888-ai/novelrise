import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const mypage = await readFile(
  new URL('../mypage.html', import.meta.url),
  'utf8'
);
const preview = await readFile(
  new URL('../scout-record.html', import.meta.url),
  'utf8'
);
const history = await readFile(
  new URL('../light-seed-history.html', import.meta.url),
  'utf8'
);

test(
  'beta navigation separates SCOUT RECORD preview from LIGHT SEED history',
  () => {
    assert.match(
      mypage,
      /href="scout-record\.html"[^>]*><span class="nav-icon">◇<\/span><span>SCOUT RECORD<\/span>/u
    );
    assert.match(
      mypage,
      /<h2>LIGHT SEED送信履歴<\/h2>[\s\S]*?href="light-seed-history\.html">履歴を見る →<\/a>/u
    );
  }
);

test('beta SCOUT RECORD is a locked low-data preview', () => {
  assert.match(
    preview,
    /<title>SCOUT RECORD βプレビュー \| NOVELIGHT<\/title>/u
  );
  assert.match(preview, /<h1 id="scoutTitle">SCOUT RECORD<\/h1>/u);
  assert.match(preview, /正式リリース時解放/u);
  assert.match(preview, /BETA \/ LOCKED PREVIEW/u);
  assert.match(
    preview,
    /href="light-seed-history\.html">送信履歴を見る →<\/a>/u
  );

  assert.doesNotMatch(preview, /supabase/iu);
  assert.doesNotMatch(preview, /light_seeds/iu);
  assert.doesNotMatch(preview, /\.from\s*\(/u);
  assert.doesNotMatch(preview, /\.rpc\s*\(/u);
  assert.doesNotMatch(preview, /作品Rank/u);
  assert.doesNotMatch(
    preview,
    /\b(?:EMBER|SPARK|GLOW|BEACON|STAR|NOVA)\b/u
  );
});

test(
  'LIGHT SEED send history remains usable during beta and stays separate',
  () => {
    assert.match(history, /<title>LIGHT SEED送信履歴 \| NOVELIGHT<\/title>/u);
    assert.match(history, /<h1>LIGHT SEED送信履歴<\/h1>/u);
    assert.match(history, /client\.from\('light_seeds'\)/u);
    assert.match(history, /login\.html\?redirect=light-seed-history\.html/u);
    assert.match(
      history,
      /href="scout-record\.html">SCOUT RECORD βプレビューを見る →<\/a>/u
    );
    assert.doesNotMatch(history, /<h1[^>]*>SCOUT RECORD<\/h1>/u);
  }
);
