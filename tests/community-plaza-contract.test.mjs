import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('community stays unpublished until approved migration and moderation', () => {
  const flags = read('novelight-community-config.js');
  assert.match(flags, /timeline:\s*false/);
  assert.match(flags, /board:\s*false/);
});

test('home live cards mount immediately below the existing carousel', () => {
  const html = read('index.html');
  const banner = html.indexOf('class="home-promo-carousel"');
  const community = html.indexOf('id="communityHomeSection"');
  const discover = html.indexOf('id="discover"');
  assert.ok(banner >= 0 && banner < community && community < discover);
  assert.match(html, /id="communityHomeFeed"/);
  assert.match(html, /タイムラインを見る/);
  assert.match(html, /掲示板を見る/);
});

test('one exchange entry is present on both header sizes', () => {
  const client = read('novelight-client.js');
  assert.equal((client.match(/href="community\.html"\$\{communityCurrent\}/g) || []).length, 2);
  const index = read('index.html');
  assert.equal((index.match(/href="community\.html">交流<\/a>/g) || []).length, 2);
});

test('author note timeline posting is explicit opt-in and keeps legacy editor compatible', () => {
  const editor = read('author-notes.html');
  assert.match(editor, /id="noteTimelineShare"/);
  assert.match(editor, /communityEnabled\?'novelight_save_my_author_note_v2':'novelight_save_my_author_note'/);
  assert.match(editor, /p_show_in_timeline:document\.getElementById\('noteTimelineShare'\)\.checked/);
});

test('feed uses bounded public RPC, scoped interactions, and no independent post form', () => {
  const code = read('novelight-community.js');
  assert.match(code, /novelight_community_feed/);
  assert.match(code, /novelight_community_toggle_like/);
  assert.match(code, /novelight_community_post_comment/);
  assert.match(code, /novelight_community_report/);
  assert.doesNotMatch(code, /\.from\(['"]author_notes['"]\)/);
  assert.doesNotThrow(() => new Function(code));
});

test('timelines and the later board share one entry and hash navigation', () => {
  const html = read('community.html');
  assert.match(html, /id="communityTimeline"/);
  assert.match(html, /id="communityBoardInfo"/);
  assert.match(html, /location\.hash==='#board'/);
  assert.match(html, /タイムライン公開後/);
});
