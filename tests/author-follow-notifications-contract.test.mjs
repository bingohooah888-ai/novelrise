import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260918140022_author_follow_notifications.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260918140022_author_follow_notifications_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260918140022_author_follow_notifications_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260918140022_author_follow_notifications_rollback.sql',
  'utf8'
);
const followUi = await readFile('novelight-author-follow.js', 'utf8');
const authorPage = await readFile('author.html', 'utf8');
const updates = await readFile('novelight-favorite-updates.js', 'utf8');
const updatesPage = await readFile('updates.html', 'utf8');
const authContext = await readFile('auth-reader-context.js', 'utf8');

test('author follows and publication events stay private behind RPCs', () => {
  assert.match(migration, /create table public\.author_follows/iu);
  assert.match(migration, /create table public\.author_follow_events/iu);
  assert.match(
    migration,
    /alter table public\.author_follows enable row level security/iu
  );
  assert.match(
    migration,
    /alter table public\.author_follow_events enable row level security/iu
  );
  assert.match(
    migration,
    /revoke all on table public\.author_follows from public, anon, authenticated/iu
  );
  assert.match(
    migration,
    /revoke all on table public\.author_follow_events from public, anon, authenticated/iu
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_set_author_follow\(uuid, boolean\)\s+to authenticated/iu
  );
  assert.match(postcheck, /raw author_follows table is client-accessible/iu);
});

test('follow baselines old publications and re-enabled notification categories', () => {
  assert.match(
    migration,
    /select coalesce\(pg_catalog\.max\(e\.id\), 0\)[\s\S]*v_new_work_cursor/iu
  );
  assert.match(
    migration,
    /select coalesce\(pg_catalog\.max\(e\.id\), 0\)[\s\S]*v_update_cursor/iu
  );
  assert.match(
    migration,
    /if p_notify_new_works and not v_follow\.notify_new_works then/iu
  );
  assert.match(
    migration,
    /if p_notify_updates and not v_follow\.notify_updates then/iu
  );
  assert.match(
    migration,
    /greatest\(v_follow\.new_work_seen_event_id, p_new_work_event_id\)/iu
  );
  assert.match(
    migration,
    /greatest\(v_follow\.update_seen_event_id, p_update_event_id\)/iu
  );
});

test('publication capture emits new-work once and excludes episode one from update events', () => {
  assert.match(
    migration,
    /create unique index author_follow_events_novel_once_idx/iu
  );
  assert.match(
    migration,
    /create unique index author_follow_events_episode_once_idx/iu
  );
  assert.match(
    migration,
    /if coalesce\(new\.episode_number, 0\) <= 1 then\s+return new;/iu
  );
  assert.match(
    migration,
    /event_type in \('novel_published', 'episode_published'\)/iu
  );
  assert.match(migration, /n\.status = 'published'/iu);
  assert.match(migration, /ep\.status = 'published'/iu);
});

test('follow and feed respect block or mute without leaking reason to the UI', () => {
  assert.match(migration, /DIRECT_INTERACTION_UNAVAILABLE/u);
  assert.match(
    migration,
    /b\.blocker_user_id = v_uid and b\.blocked_user_id = p_author_user_id/iu
  );
  assert.match(
    migration,
    /b\.blocker_user_id = p_author_user_id and b\.blocked_user_id = v_uid/iu
  );
  assert.match(
    migration,
    /m\.muter_user_id = v_uid\s+and m\.muted_user_id = e\.author_user_id/iu
  );
  assert.match(followUi, /この作者を現在フォローできません。/u);
  assert.doesNotMatch(followUi, /あなたをブロック/u);
});

test('follow is convenience-only and never changes ranking or SCOUT evidence', () => {
  assert.doesNotMatch(migration, /insert into public\.scout_/iu);
  assert.doesNotMatch(migration, /update public\.scout_/iu);
  assert.doesNotMatch(migration, /insert into public\.light_seeds/iu);
  assert.doesNotMatch(migration, /update public\.light_seeds/iu);
  assert.doesNotMatch(migration, /novel_exposure/iu);
  assert.doesNotMatch(migration, /work_rank/iu);
  assert.match(followUi, /作品評価・Rank・LIGHT SEED・露出には影響しません/u);
});

test('author profile mounts follow controls and preserves login return context', () => {
  assert.match(authorPage, /novelight-author-follow\.js/u);
  assert.match(authorPage, /NovelightAuthorFollow\.mountAuthorFollowControls/u);
  assert.match(followUi, /novelight_author_follow_state/u);
  assert.match(followUi, /novelight_set_author_follow/u);
  assert.match(followUi, /novelight_set_author_follow_notifications/u);
  assert.match(followUi, /新作通知/u);
  assert.match(followUi, /更新通知/u);
  assert.match(authContext, /'\/author\.html'/u);
  assert.match(followUi, /author\.html\?id=/u);
});

test('existing update center integrates followed authors and fails safely before DB rollout', () => {
  assert.match(updates, /novelight_followed_author_updates/u);
  assert.match(updates, /novelight_mark_author_follow_updates_seen/u);
  assert.match(updates, /groupAuthorUpdates/u);
  assert.match(updates, /isMissingAuthorFollowRpc/iu);
  assert.match(updates, /return \[\];/u);
  assert.match(updates, /from\('favorites'\)/u);
  assert.match(updatesPage, /<h1>更新通知<\/h1>/u);
  assert.match(updatesPage, /フォロー中の作者による新作・新しい話/u);
  assert.match(
    updatesPage,
    /フォロー作者の通知設定・確認状態はアカウントに保存されます/u
  );
});

test('migration has bounded precheck, postcheck, and rollback companions', () => {
  assert.match(
    precheck,
    /PRECHECK PASS: author follow prerequisites are ready/u
  );
  assert.match(
    postcheck,
    /POSTCHECK PASS: author follows are private, block-aware, and notification-only/u
  );
  assert.match(
    rollback,
    /drop trigger if exists novelight_author_follow_novel_publication/iu
  );
  assert.match(
    rollback,
    /drop function if exists public\.novelight_followed_author_updates/iu
  );
  assert.match(rollback, /drop table if exists public\.author_follow_events/iu);
  assert.match(rollback, /drop table if exists public\.author_follows/iu);
});
