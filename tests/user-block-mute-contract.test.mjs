import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const migrationUrl = new URL(
  '../supabase/migrations/20260917020000_user_block_mute.sql',
  import.meta.url
);
const rollbackUrl = new URL(
  '../supabase/rollback/20260917020000_user_block_mute_rollback.sql',
  import.meta.url
);
const commentsUrl = new URL('../novelight-comments.js', import.meta.url);
const discoveryUrl = new URL('../novelight-discovery-list.js', import.meta.url);
const safetyUrl = new URL('../novelight-user-safety.js', import.meta.url);
const authorUrl = new URL('../author.html', import.meta.url);
const homeUrl = new URL('../index.html', import.meta.url);

async function text(url) {
  return readFile(url, 'utf8');
}

test('block and mute relationships are private and authenticated-only', async () => {
  const sql = await text(migrationUrl);

  assert.match(sql, /create table public\.user_blocks/i);
  assert.match(sql, /create table public\.user_mutes/i);
  assert.match(
    sql,
    /user_blocks_no_self check \(blocker_user_id <> blocked_user_id\)/i
  );
  assert.match(
    sql,
    /user_mutes_no_self check \(muter_user_id <> muted_user_id\)/i
  );
  assert.match(
    sql,
    /alter table public\.user_blocks enable row level security/i
  );
  assert.match(
    sql,
    /alter table public\.user_mutes enable row level security/i
  );
  assert.match(
    sql,
    /revoke all on table public\.user_blocks from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /revoke all on table public\.user_mutes from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /novelight_set_user_block\(uuid, boolean\) to authenticated/i
  );
  assert.match(
    sql,
    /novelight_set_user_mute\(uuid, boolean\) to authenticated/i
  );
  assert.match(sql, /novelight_hidden_novel_ids\(text\[\]\) to authenticated/i);
});

test('block rejects direct comments before any comment or SCOUT ledger write', async () => {
  const sql = await text(migrationUrl);
  const blockCheck = sql.indexOf("message = 'DIRECT_INTERACTION_UNAVAILABLE'");
  const commentInsert = sql.indexOf(
    'insert into public.novel_comments',
    blockCheck
  );
  const eventInsert = sql.indexOf(
    'insert into public.scout_event_ledger',
    blockCheck
  );

  assert.ok(blockCheck > -1, 'block rejection must exist');
  assert.ok(
    commentInsert > blockCheck,
    'comment insert must happen after block rejection'
  );
  assert.ok(
    eventInsert > blockCheck,
    'SCOUT event insert must happen after block rejection'
  );
  assert.match(
    sql,
    /b\.blocker_user_id = v_author_id and b\.blocked_user_id = v_uid/i
  );
  assert.match(
    sql,
    /b\.blocker_user_id = v_uid and b\.blocked_user_id = v_author_id/i
  );
  assert.doesNotMatch(sql, /delete from public\.scout_xp_ledger/i);
  assert.doesNotMatch(sql, /delete from public\.scout_event_ledger/i);
});

test('mute and outbound block filter personal comments and discovery only', async () => {
  const sql = await text(migrationUrl);

  assert.match(
    sql,
    /where m\.muter_user_id = v_uid and m\.muted_user_id = c\.user_id/i
  );
  assert.match(
    sql,
    /where b\.blocker_user_id = v_uid and b\.blocked_user_id = c\.user_id/i
  );
  assert.match(
    sql,
    /create or replace function public\.novelight_hidden_novel_ids/i
  );
  assert.match(
    sql,
    /m\.muter_user_id = v_uid and m\.muted_user_id = n\.user_id/i
  );
  assert.match(
    sql,
    /b\.blocker_user_id = v_uid and b\.blocked_user_id = n\.user_id/i
  );
});

test('comment UI keeps block reason private and links commenters to safety controls', async () => {
  const js = await text(commentsUrl);
  const blockMessage = js.indexOf('DIRECT_INTERACTION_UNAVAILABLE');
  const authMessage = js.indexOf("error?.code === '42501'");

  assert.ok(blockMessage > -1 && blockMessage < authMessage);
  assert.match(js, /この作者へのコメントは現在送信できません。/);
  assert.doesNotMatch(js, /あなたはブロック/);
  assert.match(js, /author\.href = `author\.html\?id=\$\{encodeURIComponent/);
});

test('author profile exposes reversible authenticated block and mute controls', async () => {
  const [authorHtml, safetyJs] = await Promise.all([
    text(authorUrl),
    text(safetyUrl)
  ]);

  assert.match(authorHtml, /novelight-user-safety\.js/);
  assert.match(authorHtml, /NovelightUserSafety\.mountAuthorControls/);
  assert.match(safetyJs, /client\.auth\s*\.getSession\(\)/);
  assert.match(safetyJs, /currentUserId === targetUserId/);
  assert.match(safetyJs, /novelight_user_relationship/);
  assert.match(safetyJs, /novelight_set_user_block/);
  assert.match(safetyJs, /novelight_set_user_mute/);
  assert.match(safetyJs, /作品の評価・Rank・LIGHT SEEDには影響しません/);
});

test('discovery removes hidden works before rendering and impression recording', async () => {
  const js = await text(discoveryUrl);
  const filterDefinition = js.indexOf('async function filterHiddenRows');
  const hiddenRpc = js.indexOf(
    "client.rpc('novelight_hidden_novel_ids'",
    filterDefinition
  );
  const recommendedFilter = js.indexOf(
    'const filteredCandidates = await filterHiddenRows(candidates);'
  );
  const recommendedPage = js.indexOf(
    'const page = candidates.slice(0, pageSize);',
    recommendedFilter
  );
  const recommendedAppend = js.indexOf(
    'const visible = appendRows(page);',
    recommendedPage
  );
  const recommendedTelemetry = js.indexOf(
    'await recordTrusted(visible);',
    recommendedAppend
  );
  const seedPage = js.indexOf('const page = rows.slice(0, pageSize);');
  const seedOffset = js.indexOf('seedOffset += page.length;', seedPage);
  const seedFilter = js.indexOf(
    'const filteredPage = await filterHiddenRows(page);',
    seedOffset
  );
  const seedAppend = js.indexOf('const visible = appendRows(page);', seedFilter);
  const seedTelemetry = js.indexOf(
    "await recordVisible('search_seed', visible, pageOffset);",
    seedAppend
  );

  assert.ok(filterDefinition > -1 && hiddenRpc > filterDefinition);
  assert.ok(recommendedFilter > -1);
  assert.ok(recommendedPage > recommendedFilter);
  assert.ok(recommendedAppend > recommendedPage);
  assert.ok(recommendedTelemetry > recommendedAppend);
  assert.match(js, /const filtered = await filterHiddenRows\(rows\);/);
  assert.ok(seedPage > -1);
  assert.ok(seedOffset > seedPage);
  assert.ok(seedFilter > seedOffset);
  assert.ok(seedAppend > seedFilter);
  assert.ok(seedTelemetry > seedAppend);
});

test('Home filters hidden works before shelf rendering and impression recording', async () => {
  const html = await text(homeUrl);
  const filters =
    html.match(/NovelightUserSafety\.filterNovelRows\(client,/g) || [];
  const discoveryFilter = html.indexOf(
    'visible=await NovelightUserSafety.filterNovelRows(client,visible)'
  );
  const discoveryRender = html.indexOf(
    "grid.innerHTML=visible.length?visible.map(card).join('')",
    discoveryFilter
  );
  const discoveryRecord = html.indexOf('void record(visible)', discoveryRender);
  const seedFilter = html.indexOf(
    'seeded=await NovelightUserSafety.filterNovelRows(client,seeded)'
  );
  const seedRecord = html.indexOf(
    "void issueAndRecord('home_seed',seeded)",
    seedFilter
  );

  assert.match(html, /novelight-user-safety\.js/);
  assert.equal(filters.length, 4);
  assert.ok(discoveryFilter > -1);
  assert.ok(discoveryRender > discoveryFilter);
  assert.ok(discoveryRecord > discoveryRender);
  assert.ok(seedFilter > -1 && seedRecord > seedFilter);
});

test('rollback restores Chapter 38 comment behavior before dropping relationship data', async () => {
  const sql = await text(rollbackUrl);
  const restoreFeed = sql.indexOf(
    'create or replace function public.novelight_comment_feed'
  );
  const restorePost = sql.indexOf(
    'create or replace function public.post_novel_comment'
  );
  const dropBlocks = sql.indexOf('drop table if exists public.user_blocks');

  assert.ok(restoreFeed > -1 && restoreFeed < dropBlocks);
  assert.ok(restorePost > -1 && restorePost < dropBlocks);
  assert.doesNotMatch(sql, /DIRECT_INTERACTION_UNAVAILABLE/);
  assert.match(sql, /'xp_eligible', not v_is_self_comment/);
  assert.match(sql, /v_awarded_today < 3/);
});
