import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const mypage = await readFile(
  new URL('../mypage.html', import.meta.url),
  'utf8'
);
const scout = await readFile(
  new URL('../scout-record.html', import.meta.url),
  'utf8'
);
const scoutJs = await readFile(
  new URL('../novelight-scout-record.js', import.meta.url),
  'utf8'
);
const scoutCss = await readFile(
  new URL('../novelight-scout-record.css', import.meta.url),
  'utf8'
);
const history = await readFile(
  new URL('../light-seed-history.html', import.meta.url),
  'utf8'
);

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

test('SCOUT RECORD uses Author Studio shell and full beta information architecture', () => {
  assert.match(scout, /<title>SCOUT RECORD \| NOVELIGHT<\/title>/u);
  assert.match(scout, /<h1>SCOUT RECORD<\/h1>/u);
  assert.match(scout, /あなたの発掘実績とスカウトとしての成長/u);
  assert.match(scout, /novelight-author-home\.css/u);
  assert.match(scout, /novelight-author-room\.css/u);
  assert.match(scout, /novelight-author-studio-shell\.js/u);
  assert.match(scout, /novelight-scout-record\.css/u);
  assert.match(scout, /novelight-scout-record\.js/u);
  assert.match(scout, /Rank Path/u);
  assert.match(scout, /Badge Collection/u);
  assert.match(scout, /data-badge-category="reader"/u);
  assert.match(scout, /data-badge-category="author"/u);
  assert.match(scout, /data-badge-category="limited"/u);
  assert.match(scout, /data-badge-status="earned"/u);
  assert.match(scout, /data-badge-status="unearned"/u);
  assert.match(scout, /β版のScout Level上限はLv\.30/u);
  assert.match(scout, /AI利用特典への交換を予定/u);
});

test('SCOUT RECORD loads owner progression, badge progress and visibility through RPCs', () => {
  assert.match(scoutJs, /novelight_scout_record_summary/u);
  assert.match(scoutJs, /novelight_scout_point_history/u);
  assert.match(scoutJs, /novelight_scout_recent_activity/u);
  assert.match(scoutJs, /novelight_scout_discoveries/u);
  assert.match(scoutJs, /novelight_scout_badges/u);
  assert.match(scoutJs, /novelight_set_scout_badge_visibility/u);
  assert.match(scoutJs, /novelight_record_scout_record_visit/u);
  assert.match(scoutJs, /SCOUT RECORD usage telemetry failed/u);
  assert.match(scoutJs, /progress_percent/u);
  assert.match(scoutJs, /progress_value/u);
  assert.match(scoutJs, /login\.html\?redirect=scout-record\.html/u);
  assert.doesNotMatch(scoutJs, /\.from\(['"]scout_/u);
  assert.doesNotMatch(scoutJs, /\.from\(['"]seed_discovery_state/u);
});

test('Badge UI includes percent + meter and mobile two-column grid', () => {
  assert.match(scoutCss, /\.badge-progress/u);
  assert.match(scoutJs, /toFixed\(0\).*%/u);
  assert.match(scoutJs, /progressBar\.style\.width/u);
  assert.match(
    scoutCss,
    /@media\(max-width:700px\)[\s\S]*?\.badge-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u
  );
});

test(
  'Badge filters include difficulty and canonical Reader catalog no longer shows recovery placeholder',
  () => {
  assert.match(scout, /data-badge-difficulty="easy"/u);
  assert.match(scout, /data-badge-difficulty="normal"/u);
  assert.match(scout, /data-badge-difficulty="hard"/u);
  assert.match(scoutJs, /badgeDifficulty/u);
    assert.doesNotMatch(
      scoutJs,
      /Reader Badge 100件の個別条件は、採用済みの元リストを復元後に有効化します/u
    );
  }
);

test(
  'Master Scout detail can render all composite component progresses',
  () => {
  assert.match(scout, /id="badgeDialogComposite"/u);
  assert.match(scoutJs, /composite_progress/u);
  assert.match(scoutJs, /badge-composite-item/u);
  assert.match(scoutJs, /current/u);
  assert.match(scoutJs, /target/u);
  assert.match(scoutCss, /\.badge-composite/u);
    assert.match(scoutCss, /\.badge-composite-meter/u);
  }
);

test('LIGHT SEED history remains separate but links back to live SCOUT RECORD', () => {
  assert.match(history, /<title>LIGHT SEED送信履歴 \| NOVELIGHT<\/title>/u);
  assert.match(history, /<h1>LIGHT SEED送信履歴<\/h1>/u);
  assert.match(history, /client\.from\('light_seeds'\)/u);
  assert.match(history, /login\.html\?redirect=light-seed-history\.html/u);
  assert.match(history, /href="scout-record\.html">SCOUT RECORDを見る →<\/a>/u);
  assert.doesNotMatch(history, /SCOUT RECORD βプレビューを見る/u);
});