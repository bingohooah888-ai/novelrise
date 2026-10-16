import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const author = await readFile('author.html', 'utf8');
const js = await readFile('novelight-public-scout.js', 'utf8');
const css = await readFile('novelight-public-scout.css', 'utf8');

test('author profile has a public SCOUT RECORD surface', () => {
  assert.match(author, /id="publicScoutRecord"/u);
  assert.match(author, /novelight-public-scout\.css/u);
  assert.match(author, /novelight-public-scout\.js/u);
});

test('public SCOUT RECORD loads only the public-safe RPC', () => {
  assert.match(js, /novelight_public_scout_record/u);
  assert.match(js, /Scout Level/u);
  assert.doesNotMatch(js, /<span>発掘成功/u);
  assert.match(js, /装備称号/u);
  assert.match(js, /代表的な発掘実績/u);
  assert.doesNotMatch(
    js,
    /scout_point_ledger|point_balance|pending_points|total_xp|next_level_xp/iu
  );
});

test('public SCOUT rank shows official artwork beside Scout Level', () => {
  assert.match(js, /scout_rank_01_noctis\.png/u);
  assert.match(js, /scout_rank_02_vesper\.png/u);
  assert.match(js, /scout_rank_03_umbra\.png/u);
  assert.match(js, /scout_rank_10_luminaris\.png/u);
  assert.match(js, /class="public-scout-rank-image"/u);
  assert.match(js, /optimizedArtworkPath\(rankArtwork\)/u);
  assert.match(js, /rankImage\.src = rankArtwork/u);
  assert.match(js, /rankImage\.complete/u);
  assert.match(js, /<div class="public-scout-summary">/u);
  assert.match(css, /\.public-scout-emblem\{position:relative/u);
  assert.match(css, /\.public-scout-rank\{display:flex;align-items:center/u);
  assert.doesNotMatch(js, /SCOUT RANK —/u);
  assert.doesNotMatch(js, /class="public-scout-badges"/u);
  assert.doesNotMatch(js, /data\.discovery_success_count/u);
});

test('one equipped title is mounted inside the public profile card', () => {
  assert.match(js, /const equippedTitle = titles\[0\] \|\| null/u);
  assert.match(js, /mountEquippedTitle\(equippedTitle\)/u);
  assert.match(js, /profileHost\.querySelector\('\.name'\)/u);
  assert.match(js, /public-profile-equipped-title/u);
  assert.match(js, /name\.insertAdjacentElement\('afterend', badge\)/u);
  assert.match(js, /limited_founding_author/u);
  assert.match(js, /assets\/founding-authors-badge-2026\.png/u);
  assert.match(js, /assets\/scout-badges/u);
  assert.match(js, /hard_reader_read_500/u);
  assert.match(js, /reader\|author\|limited/u);
});

test('public profile centers pen name, badge, and equipped title in three equal columns', () => {
  assert.match(js, /badge\.appendChild\(artworkWrap\)/u);
  assert.match(js, /titleName\.textContent = title\.display_name/u);
  assert.match(js, /badge\.insertAdjacentElement\('afterend', titleName\)/u);
  assert.match(js, /profileHost\.classList\.add\('has-equipped-title'\)/u);
  assert.doesNotMatch(js, /public-profile-equipped-copy/u);
  assert.match(
    css,
    /#profile\.has-equipped-title\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/u
  );
  assert.match(css, />\.name\{grid-column:1;grid-row:1/u);
  assert.match(css, /justify-self:center;align-self:center;text-align:center/u);
  assert.match(css, />\.bio\{grid-column:1\/-1;grid-row:2/u);
  assert.match(css, />\.public-profile-equipped-name\{grid-column:3;grid-row:1/u);
  assert.match(
    css,
    />\.public-profile-equipped-title\{grid-column:2;grid-row:1;justify-self:center;align-self:center/u
  );
  assert.match(
    css,
    />\.author-follow-controls,.*>\.user-safety-controls\{grid-column:1\/-1\}/u
  );
  assert.match(
    css,
    /\.public-profile-equipped-title\{display:block;width:120px;height:120px;.*border:0;background:transparent/u
  );
  assert.match(
    css,
    /@media\(max-width:640px\)\{\.novelight-page-author #profile\.has-equipped-title\{column-gap:8px/u
  );
});

test('equipped title artwork has a safe fallback and responsive styling', () => {
  assert.match(js, /image\.addEventListener\('error'/u);
  assert.match(css, /\.public-profile-equipped-title\{/u);
  assert.match(css, /\.public-profile-equipped-artwork\{/u);
  assert.match(css, /\.public-profile-equipped-fallback/u);
});

test('public SCOUT surface remains mobile responsive', () => {
  assert.match(css, /@media\(max-width:640px\)/u);
  assert.match(css, /\.public-scout-summary\{gap:10px\}/u);
});
