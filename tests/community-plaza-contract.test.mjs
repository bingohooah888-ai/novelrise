import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

function read(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

test('community is hidden before approval', () => {
  const flags = read('novelight-community-config.js');
  assert.match(flags, /timeline:\s*false/);
  assert.match(flags, /board:\s*false/);
});

test('home community follows banner and precedes discovery', () => {
  const html = read('index.html');
  const banner = html.indexOf('class="home-promo-carousel"');
  const community = html.indexOf('id="communityHomeSection"');
  const discover = html.indexOf('id="discover"');
  assert.ok(banner >= 0 && banner < community && community < discover);
  assert.match(html, /id="communityHomeFeed"/);
  assert.match(html, /タイムラインを見る/);
  assert.match(html, /掲示板を見る/);
});

test('one exchange destination is gated on shared headers', () => {
  const client = read('novelight-client.js');
  const matches = client.match(/href="community\.html"\$\{communityCurrent\}/g);
  assert.equal(matches?.length, 2);
  assert.match(client, /NOVELIGHT_COMMUNITY_FLAGS\.timeline \?/);
  const index = read('index.html');
  assert.doesNotMatch(index, /href="community\.html">交流<\/a>/);
});

test('near-note sharing is an explicit opt-in', () => {
  const editor = read('author-notes.html');
  assert.match(editor, /id="noteTimelineShare"/);
  assert.match(editor, /notePublicSafety/);
  assert.match(editor, /novelight_save_my_author_note_v2/);
  assert.match(editor, /p_show_in_timeline:/);
});

test('community feed uses bounded RPCs instead of raw notes', () => {
  const code = read('novelight-community.js');
  assert.match(code, /novelight_community_feed/);
  assert.match(code, /novelight_community_toggle_like/);
  assert.match(code, /novelight_community_post_comment/);
  assert.match(code, /novelight_community_report/);
  assert.doesNotMatch(code, /\.from\(['"]author_notes['"]\)/);
  assert.doesNotThrow(() => new Function(code));
});

test('timeline and board share one page', () => {
  const html = read('community.html');
  assert.match(html, /id="communityTimeline"/);
  assert.match(html, /id="communityBoardInfo"/);
  assert.match(html, /location\.hash==='#board'/);
  assert.match(html, /タイムライン公開後/);
});

test('ADMIN bearer protects moderator changes', () => {
  const handler = read('api/_lib/admin-community.js');
  const entry = read('api/admin-community.js');
  assert.match(handler, /requireAdmin/);
  assert.match(handler, /novelight_admin_community_moderate/);
  assert.match(entry, /SUPABASE_SECRET_KEY/);
});

test('review SQL protects private rows and notifications', () => {
  const sql = read('docs/COMMUNITY-PHASE1-DB-REVIEW-DRAFT.sql');
  const quotes = sql.match(/\$\$/g) || [];
  assert.doesNotMatch(sql, /^AS \$|^\$;$/m);
  assert.equal(quotes.length % 2, 0);
  const tables = [
    'community_reactions',
    'community_comments',
    'community_reports',
    'community_hidden_posts',
    'community_user_restrictions',
    'community_notifications'
  ];
  for (const table of tables) {
    const rls = 'ALTER TABLE public.' + table + ' ENABLE ROW LEVEL SECURITY';
    assert.ok(sql.includes(rls), rls);
  }
  assert.match(sql, /TO service_role;/);
  assert.match(sql, /ON CONFLICT\(event_key\) DO NOTHING/);
  assert.match(sql, /NOT public\.novelight_community_interaction_allowed/);
  assert.doesNotMatch(sql, /UPDATE public\.novel_rank/);
  assert.match(
    sql,
    /novelight_save_my_author_note_v2\(bigint,text,text,bigint,boolean,boolean\) TO authenticated/
  );
  assert.match(sql, /Logged-in users must not bypass author Block\/Mute/);
  assert.match(sql, /note\.linked_novel_id IS NULL OR linked\.id IS NOT NULL/);
});

test('community journeys override source without altering acquisition', () => {
  const client = read('novelight-client.js');
  assert.match(client, /function readerJourneySource\(\)/);
  assert.match(client, /marker === 'community'/);
  assert.match(client, /source: readerJourneySource\(\)/);
  assert.match(client, /async function recordVisit\(client\)/);
});

test('owner metrics use existing qualified reads rather than PV', () => {
  const sql = read('docs/COMMUNITY-PHASE1-DB-REVIEW-DRAFT.sql');
  assert.match(sql, /public\.valid_read_events/);
  assert.match(sql, /public\.reader_journey_events/);
  assert.match(sql, /e\.source='community'/);
  assert.match(sql, /novelight_admin_community_metrics\(integer\)/);
  assert.match(sql, /TO service_role;/);
  const admin = read('api/_lib/admin-community.js');
  assert.match(admin, /novelight_admin_community_metrics/);
  assert.match(admin, /requireAdmin/);
});

test('shared URL alone never permits curation-wide timeline discovery', () => {
  const sql = read('docs/COMMUNITY-PHASE1-DB-REVIEW-DRAFT.sql');
  const defaultOptIn = 'community_share_enabled boolean NOT NULL DEFAULT false';
  assert.ok(sql.includes(defaultOptIn));
  assert.ok(sql.includes("visibility='shared' AND l.community_share_enabled"));
  assert.match(sql, /novelight_set_my_curation_community_share/);
  assert.match(sql, /community_curation_visibility_guard/);
  const ui = read('curation-lists.html');
  assert.match(ui, /novelight_manage_my_curation_lists_v2/);
  assert.match(ui, /公開範囲が広がります/);
  assert.match(read('novelight-community.js'), /curationDetails/);
});

test('light seed timeline publicity requires explicit donor consent', () => {
  const sql = read('docs/COMMUNITY-PHASE1-DB-REVIEW-DRAFT.sql');
  assert.ok(sql.includes('community_seed_shares ENABLE ROW LEVEL SECURITY'));
  assert.match(sql, /novelight_set_my_seed_community_share/);
  assert.match(sql, /s\.reader_id=v_user/);
  assert.ok(sql.includes('seed:[0-9a-f-]'));
  const history = read('light-seed-history.html');
  assert.match(history, /novelight_my_seed_community_shares/);
  assert.match(history, /交流広場にも共有する/);
});
