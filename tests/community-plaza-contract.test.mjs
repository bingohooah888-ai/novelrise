import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

function read(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}
const COMMUNITY_SQL =
  'supabase/migrations/' + '20261014052000_community_plaza_phase1.sql';

test('community flags are paired for joint release', () => {
  const flags = read('novelight-client.js');
  assert.match(flags, /timeline:\s*true/);
  assert.match(flags, /board:\s*true/);
  const config = read('novelight-community-config.js');
  assert.match(config, /timeline:false, board:false/);
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

test('shared headers use a single exchange destination after joint release', () => {
  const client = read('novelight-client.js');
  const matches = client.match(/href="community\.html"\$\{communityCurrent\}/g);
  assert.equal(matches?.length, 2);
  assert.match(client, /timeline:\s*true/u);
  assert.match(client, /board:\s*true/u);
  const index = read('index.html');
  assert.match(index, /href="community\.html">交流<\/a>/);
  assert.match(
    read('shared/header/public-header.html'),
    /href="community\.html"/u
  );
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
  assert.match(html, /交流広場を読み込んでいます/);
  assert.match(html, /id="communityPending"/);
  assert.match(html, /if \(!flags\.timeline \|\| !flags\.board\)/);
});

test('ADMIN bearer protects moderator changes', () => {
  const handler = read('api/_lib/admin-community.js');
  const entry = read('api/admin-community.js');
  assert.match(handler, /requireAdmin/);
  assert.match(handler, /novelight_admin_community_moderate/);
  assert.match(handler, /novelight_admin_community_dismiss_report/);
  assert.match(handler, /report_id: reportId/);
  assert.match(entry, /SUPABASE_SECRET_KEY/);
});

test('review SQL protects private rows and notifications', () => {
  const sql = read(COMMUNITY_SQL);
  const quotes = sql.match(/\$\$/g) || [];
  assert.doesNotMatch(sql, /^(?:AS \$|\$;)$/m);
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
  assert.match(sql, /novelight_admin_community_dismiss_report/);
  assert.match(sql, /status='dismissed'/);
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
  const sql = read(COMMUNITY_SQL);
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
  const sql = read(COMMUNITY_SQL);
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
  const sql = read(COMMUNITY_SQL);
  assert.ok(sql.includes('community_seed_shares ENABLE ROW LEVEL SECURITY'));
  assert.match(sql, /novelight_set_my_seed_community_share/);
  assert.match(sql, /s\.reader_id=v_user/);
  assert.ok(sql.includes('seed:[0-9a-f-]'));
  const history = read('light-seed-history.html');
  assert.match(history, /novelight_my_seed_community_shares/);
  assert.match(history, /交流広場にも共有する/);
});

test('legacy note edits invalidate old timeline consent', () => {
  const sql = read(COMMUNITY_SQL);
  assert.match(sql, /community_author_note_consent_guard/);
  assert.match(sql, /NEW\.show_in_timeline:=false/);
  assert.match(sql, /BEFORE UPDATE OF title,body,linked_novel_id,status/);
});

test('shared list URL and content changes invalidate global consent', () => {
  const sql = read(COMMUNITY_SQL);
  assert.match(sql, /new\.share_token IS DISTINCT FROM old\.share_token/);
  assert.match(sql, /new\.title IS DISTINCT FROM old\.title/);
  assert.match(sql, /new\.description IS DISTINCT FROM old\.description/);
  assert.match(
    sql,
    /BEFORE UPDATE OF visibility,share_token,title,description/
  );
});

test('disposable DB role test covers guest and staff RPC gates', () => {
  const sql = read('tests/rls/community-plaza-phase1-security.sql');
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /ROLLBACK;/);
  assert.match(sql, /SET LOCAL ROLE anon/);
  assert.match(sql, /SET LOCAL ROLE authenticated/);
  assert.match(sql, /has_table_privilege/);
  assert.match(sql, /has_function_privilege/);
  assert.match(sql, /novelight_admin_community_moderate/);
});

test('episode publication grouping uses an explicit GROUP BY key', () => {
  const sql = read(COMMUNITY_SQL);
  assert.ok(sql.includes("SELECT 'episode', 'ep:' || e.author_user_id::text"));
  assert.ok(sql.includes("' || n.id::text ||"));
  assert.ok(
    sql.includes('GROUP BY e.author_user_id,n.id,n.title,n.thumbnail_url')
  );
});

test('hidden posts are inaccessible through all community RPCs', () => {
  const sql = read(COMMUNITY_SQL);
  assert.match(
    sql,
    /WHEN EXISTS \(\s*SELECT 1 FROM public\.community_hidden_posts h/
  );
  assert.match(sql, /NOT public\.novelight_community_post_visible\(p_key\)/);
  const fixture = read('tests/rls/community-plaza-phase1-behavior.sql');
  assert.match(fixture, /Hidden post accepted direct like/);
  assert.match(fixture, /Blocked author direct comments RPC leaked/);
  assert.match(fixture, /Rotated share-token retained public feed consent/);
});

test('versioned migration is canonical', () => {
  const migration = read(COMMUNITY_SQL);
  const draft = read('docs/COMMUNITY-PHASE1-DB-REVIEW-DRAFT.sql');
  const script = read('scripts/run-rls-integration.sh');
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS public\.community_reactions/
  );
  assert.match(migration, /community_author_note_consent_guard/);
  assert.match(
    draft,
    /supabase\/migrations\/20261014052000_community_plaza_phase1\.sql/
  );
  assert.match(script, /20261014052000_community_plaza_phase1_rollback\.sql/);
});

test('public community access has a default-off database switch', () => {
  const sql = read(COMMUNITY_SQL);
  assert.match(sql, /community_runtime_control/);
  assert.match(sql, /public_enabled boolean NOT NULL DEFAULT false/);
  assert.match(sql, /THEN RETURN '\[\]'::jsonb/);
  const fixture = read('tests/rls/community-plaza-phase1-behavior.sql');
  assert.match(fixture, /Public community RPC active before release/);
});
