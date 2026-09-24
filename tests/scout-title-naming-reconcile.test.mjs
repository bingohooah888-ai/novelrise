import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scoutHtml = await readFile('scout-record.html', 'utf8');
const scoutJs = await readFile('novelight-scout-record.js', 'utf8');
const publicJs = await readFile('novelight-public-scout.js', 'utf8');
const mypage = await readFile('mypage.html', 'utf8');
const episodePost = await readFile('episode-post.html', 'utf8');
const adminScout = await readFile('admin-scout.html', 'utf8');
const migration = await readFile(
  'supabase/migrations/20260925062000_scout_title_naming_and_equipped_title.sql',
  'utf8'
);

const scoutRanks = [
  'NOCTIS',
  'VESPER',
  'UMBRA',
  'ASTRA',
  'LUCENT',
  'AURELIS',
  'CELESTIA',
  'EMPYREAN',
  'SERAPH',
  'LUMINARIS'
];

test('SCOUT RECORD uses the finalized title terminology', () => {
  assert.match(scoutHtml, /称号コレクション/u);
  assert.match(scoutHtml, /読者称号・作者称号・限定称号/u);
  assert.match(scoutHtml, /装備称号にする/u);
  assert.match(scoutHtml, /装備できる称号は1つ/u);
  assert.doesNotMatch(scoutHtml, /Badge Collection|公開Badge|獲得Badge/u);
  assert.match(mypage, /Scout Rank・Level・称号・Scout Point/u);
  assert.match(adminScout, /Scout Point・称号・LIGHT SEED/u);
});

test('Scout Rank display uses all finalized names', () => {
  for (const rank of scoutRanks) {
    assert.match(scoutJs, new RegExp(rank, 'u'));
    assert.match(publicJs, new RegExp(rank, 'u'));
  }
  assert.match(scoutJs, /SCOUT RANK — \$\{rankNames\[tier\]\}/u);
  assert.doesNotMatch(scoutJs, /SCOUT RANK \$\{rankRoman/u);
  assert.doesNotMatch(publicJs, /RANK \$\{esc\(romans/u);
});

test('work Rank display uses the finalized EMBER to NOVA names', () => {
  for (const rank of ['EMBER', 'SPARK', 'GLOW', 'BEACON', 'STAR', 'NOVA']) {
    assert.match(scoutJs, new RegExp(rank, 'u'));
    assert.match(adminScout, new RegExp(rank, 'u'));
  }
  assert.doesNotMatch(scoutJs, /送信時 Rank \$\{n\(row\.rank_at_seed\)\}/u);
});

test('LIGHT READY is replaced by 公開チェック in the author UI', () => {
  assert.match(episodePost, />公開チェック</u);
  assert.doesNotMatch(episodePost, /LIGHT READY｜公開前チェック/u);
});

test('catalog display names are reconciled without renaming internal badge ids', () => {
  for (const title of [
    'FIRST PAGE',
    'ARCHELIGHT',
    'INKBORN',
    'CONSTELLATION MAKER',
    'DAWNBOUND'
  ]) {
    assert.match(migration, new RegExp(title, 'u'));
  }
  assert.match(migration, /reader_master_scout/u);
  assert.match(migration, /author_discovered_plus2_005/u);
  assert.match(migration, /limited_beta_participant/u);
  assert.match(migration, /alter column is_public set default false/u);
  assert.match(migration, /when 'badge' then '読者称号'/u);
  assert.match(migration, /coalesce\(b\.is_public, false\)/u);
  assert.match(migration, /user_scout_single_equipped_title_idx/u);
  assert.match(migration, /scout_title_default_unequipped/u);
});

test('equipping a title enforces one public title per user', () => {
  assert.match(
    migration,
    /update public\.user_scout_badges b[\s\S]*?set is_public = false[\s\S]*?where b\.user_id = v_uid[\s\S]*?and b\.is_public/u
  );
  assert.match(
    migration,
    /set is_public = true[\s\S]*?badge_id = p_badge_id[\s\S]*?status = 'earned'/u
  );
  assert.match(scoutJs, /badgeRows\.forEach/u);
  assert.match(scoutJs, /装備中/u);
  assert.match(scoutJs, /装備を外す/u);
  assert.match(publicJs, /装備称号/u);
});
