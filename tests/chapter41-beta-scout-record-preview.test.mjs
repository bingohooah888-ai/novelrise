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

const easyBadgeArtworkIds = `
reader_read_001
reader_read_005
reader_read_010
reader_read_025
reader_rating_001
reader_rating_005
reader_rating_010
reader_comment_001
reader_comment_005
reader_comment_010
reader_seed_001
reader_seed_003
reader_seed_005
reader_seed_010
reader_bronze_seed_001
reader_silver_seed_001
reader_gold_seed_001
reader_discovery_plus2_001
reader_discovery_plus2_002
reader_discovery_plus2_003
reader_new_author_005
reader_new_author_010
reader_genre_003
reader_genre_005
reader_new_work_005
reader_low_rank_005
reader_level_005
reader_level_010
reader_level_020
reader_active_days_007
`
  .trim()
  .split(/\s+/u);

test('beta navigation links to the live SCOUT RECORD surface', () => {
  assert.match(
    mypage,
    /href="scout-record\.html"[^>]*><span class="nav-icon">◇<\/span><span>SCOUT RECORD<\/span>/u
  );
  assert.match(
    mypage,
    /<h2>SCOUT RECORD<\/h2>[\s\S]*?href="scout-record\.html">スカウトレコードを見る →<\/a>/u
  );
  assert.doesNotMatch(mypage, /<h2>LIGHT SEED送信履歴<\/h2>/u);
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
  assert.match(scout, /称号コレクション/u);
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

test('Title UI includes percent + meter and mobile two-column grid', () => {
  assert.match(scoutCss, /\.badge-progress/u);
  assert.match(scoutJs, /toFixed\(0\).*%/u);
  assert.match(scoutJs, /progressBar\.style\.width/u);
  assert.match(
    scoutCss,
    /@media\(max-width:700px\)[\s\S]*?\.badge-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u
  );
});

test('Title difficulty accordions and Reader catalog are live', () => {
  assert.match(scout, /<details class="badge-group" data-badge-group="easy">/u);
  assert.doesNotMatch(scout, /data-badge-group="easy" open/u);
  assert.match(scout, /data-badge-group="normal"/u);
  assert.match(scout, /data-badge-group="hard"/u);
  assert.doesNotMatch(scout, /data-badge-difficulty=/u);
  assert.doesNotMatch(scoutJs, /badgeDifficulty/u);
  assert.match(scoutJs, /badgeGroupDefinitions/u);
  assert.doesNotMatch(
    scoutJs,
    /Reader Badge 100件の個別条件は、採用済みの元リストを復元後に有効化します/u
  );
  assert.match(scoutCss, /\.scout-page-head p\{font-size:18px\}/u);
  assert.match(scoutCss, /\.badge-card h3\{font-size:16px\}/u);
  assert.match(scoutCss, /color:#fff/u);
  assert.match(
    scoutCss,
    /body\.novelight-page-scout-record \.scout-section-head h2,[\s\S]*?color:#fff8e8!important/u
  );
  assert.match(
    scoutCss,
    /body\.novelight-page-scout-record \.badge-card,[\s\S]*?background:#0b2034!important[\s\S]*?opacity:1!important/u
  );
  assert.match(
    scoutCss,
    /body\.novelight-page-scout-record \.badge-card\.unearned\{[\s\S]*?background:#10283e!important/u
  );
  assert.match(
    scoutCss,
    /body\.novelight-page-scout-record \.badge-point,[\s\S]*?color:#ffe082!important/u
  );
  assert.match(
    scoutCss,
    /body\.novelight-page-scout-record \.badge-icon-artwork\{[\s\S]*?width:144px!important;[\s\S]*?margin:0 auto 16px!important/u
  );
  assert.match(
    scoutCss,
    /@media\(max-width:520px\)[\s\S]*?body\.novelight-page-scout-record \.badge-icon-artwork\{[\s\S]*?width:112px!important;[\s\S]*?height:112px!important/u
  );
  assert.match(
    scoutCss,
    /body\.novelight-page-scout-record \.badge-card h3\{[\s\S]*?font-size:18px!important/u
  );
  assert.match(
    scoutCss,
    /body\.novelight-page-scout-record \.badge-meta\{[\s\S]*?font-size:15px!important/u
  );
  assert.match(
    scoutCss,
    /body\.novelight-page-scout-record \.badge-point\{[\s\S]*?font-size:16px!important/u
  );
});

test('Easy Reader badges use individual PNG artwork assets', async () => {
  assert.equal(easyBadgeArtworkIds.length, 30);
  assert.doesNotMatch(
    scoutJs,
    /easyReaderBadgeSpriteIndexes|applyBadgeSprite|badgeSpritePosition/u
  );
  assert.doesNotMatch(
    scoutCss,
    /scout-reader-easy-badges\.webp|badge-icon-sprite|badge-dialog-sprite/u
  );

  for (const badgeId of easyBadgeArtworkIds) {
    assert.match(
      scoutJs,
      new RegExp(`${badgeId}: 'assets/scout-badges/${badgeId}\\.png'`, 'u')
    );
    const bytes = await readFile(
      new URL(`../assets/scout-badges/${badgeId}.png`, import.meta.url)
    );
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${badgeId} must be a PNG`
    );
    assert.equal(bytes.readUInt32BE(16), 384, `${badgeId} width`);
    assert.equal(bytes.readUInt32BE(20), 384, `${badgeId} height`);
  }
});

test('Master Scout renders composite progress', () => {
  assert.match(scout, /id="badgeDialogComposite"/u);
  assert.match(scoutJs, /composite_progress/u);
  assert.match(scoutJs, /badge-composite-item/u);
  assert.match(scoutJs, /current/u);
  assert.match(scoutJs, /target/u);
  assert.match(scoutCss, /\.badge-composite/u);
  assert.match(scoutCss, /\.badge-composite-meter/u);
});

test('LIGHT SEED history is integrated while the legacy route stays compatible', () => {
  assert.match(scout, /<h2 id="seedHistoryTitle">LIGHT SEED送信履歴<\/h2>/u);
  assert.match(scout, /id="seedHistoryList"/u);
  assert.match(scoutJs, /\.from\('light_seeds'\)/u);
  assert.match(history, /<title>LIGHT SEED送信履歴 \| NOVELIGHT<\/title>/u);
  assert.match(history, /<h1>LIGHT SEED送信履歴<\/h1>/u);
  assert.match(history, /client\.from\('light_seeds'\)/u);
  assert.match(history, /login\.html\?redirect=light-seed-history\.html/u);
  assert.match(history, /href="scout-record\.html">SCOUT RECORDを見る →<\/a>/u);
});
