import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');

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

test('one release-gated exchange entry is present on both shared headers', () => {
  const client = read('novelight-client.js');
  assert.equal(
    (client.match(/href="community\.html"\$\{communityCurrent\}/g) || []).length,
    2
  );
  assert.match(client, /NOVELIGHT_COMMUNITY_FLAGS\.timeline \?/);
  const index = read('index.html');
  assert.equal((index.match(/href="community\.html">交流<\/a>/g) || []).length, 0);
});

test('author note timeline posting is explicit opt-in and remains compatible', () => {
  const editor = read('author-notes.html');
  assert.match(editor, /id="noteTimelineShare"/);
  assert.match(editor, /notePublicSafety/);
  assert.match(
    editor,
    /communityEnabled\?'novelight_save_my_author_note_v2':'novelight_save_my_author_note'/
  );
  assert.match(
    editor,
    /p_show_in_timeline:document\.getElementById\('noteTimelineShare'\)\.checked/
  );
});

test('feed uses bounded RPCs and no duplicate author-note storage', () => {
  const code = read('novelight-community.js');
  assert.match(code, /novelight_community_feed/);
  assert.match(code, /novelight_community_toggle_like/);
  assert.match(code, /novelight_community_post_comment/);
  assert.match(code, /novelight_community_report/);
  assert.doesNotMatch(code, /\.from\(['"]author_notes['"]\)/);
  assert.doesNotThrow(() => new Function(code));
});

test('timeline and later board share one landing page', () => {
  const html = read('community.html');
  assert.match(html, /id="communityTimeline"/);
  assert.match(html, /id="communityBoardInfo"/);
  assert.match(html, /location\.hash==='#board'/);
  assert.match(html, /タイムライン公開後/);
});

test('ADMIN bearer and dedicated atomic RPC protect staff changes', () => {
  const handler = read('api/_lib/admin-community.js');
  const entry = read('api/admin-community.js');
  assert.match(handler, /requireAdmin/);
  assert.match(handler, /novelight_admin_community_moderate/);
  assert.match(entry, /SUPABASE_SECRET_KEY/);
  assert.doesNotThrow(
    () => new Function(read('novelight-community-config.js'))
  );
});

test('review SQL declares private RLS and idempotent event rules', () => {
  const migration = read('docs/COMMUNITY-PHASE1-DB-REVIEW-DRAFT.sql');
  assert.equal(
    (migration.match(/\$\$/g) || []).length % 2,
    0,
    'balanced dollar quotes'
  );
  for (const table of [
    'community_reactions',
    'community_comments',
    'community_reports',
    'community_hidden_posts',
    'community_user_restrictions',
    'community_notifications'
  ]) {
    assert.match(
      migration,
      new RegExp('ALTER TABLE public\\.' + table + ' ENABLE ROW LEVEL SECURITY')
    );
  }
  assert.match(migration, /TO service_role;/);
  assert.match(migration, /ON CONFLICT\(event_key\) DO NOTHING/);
  assert.match(
    migration,
    /NOT public\.novelight_community_interaction_allowed/
  );
  assert.doesNotMatch(migration, /UPDATE public\.novel_rank/);
});
