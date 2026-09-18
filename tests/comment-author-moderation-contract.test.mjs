import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260918192000_comment_author_moderation.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260918192000_comment_author_moderation_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260918192000_comment_author_moderation_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260918192000_comment_author_moderation_rollback.sql',
  'utf8'
);
const commentsRuntime = await readFile('novelight-comments.js', 'utf8');
const commentsCss = await readFile('novelight-comments.css', 'utf8');
const migrationReplay = await readFile(
  'scripts/run-migration-replay.sh',
  'utf8'
);

test('B #14 adds bounded author moderation without a second comment system', () => {
  assert.match(
    migration,
    /alter table public\.novel_comments[\s\S]*add column author_hidden_at/iu
  );
  assert.match(migration, /add column pinned_at/iu);
  assert.match(migration, /add column author_reply_body/iu);
  assert.match(
    migration,
    /create table public\.novel_comment_moderation_events/iu
  );
  assert.doesNotMatch(
    migration,
    /create table public\.(?:comments|author_comments|comment_threads)\b/iu
  );
  assert.match(
    migration,
    /create unique index novel_comments_one_visible_pin_per_novel_idx[\s\S]*where pinned_at is not null/iu
  );
});

test('pin, hide, and reply are owner-only SECURITY DEFINER RPCs with narrow grants', () => {
  for (const fn of [
    'novelight_set_comment_pin',
    'novelight_set_comment_hidden',
    'novelight_set_comment_author_reply'
  ]) {
    assert.match(
      migration,
      new RegExp(
        `create or replace function public\\.${fn}[\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`,
        'iu'
      )
    );
  }

  assert.match(
    migration,
    /n\.user_id[\s\S]*v_author_id[\s\S]*v_author_id <> v_uid/iu
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_set_comment_pin\(uuid, boolean\)[\s\S]*to authenticated/iu
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.novelight_set_comment_pin\(uuid, boolean\)\s+to anon/iu
  );
});

test('soft moderation preserves comment and SCOUT evidence', () => {
  assert.match(
    migration,
    /author soft-moderation state\. Does not delete comment or alter SCOUT\/Rank history/iu
  );
  assert.doesNotMatch(
    migration,
    /delete from public\.novel_comments|delete from public\.scout_event_ledger|delete from public\.scout_xp_ledger/iu
  );
  assert.match(
    migration,
    /action in \('pin','unpin','hide','unhide','reply_set','reply_removed'\)/iu
  );
  assert.match(migration, /if v_pinned_at is not null then[\s\S]*'unpin'/iu);
});

test('author replies remain one-per-comment and respect the existing block boundary', () => {
  assert.match(
    migration,
    /set author_reply_body = v_body,[\s\S]*author_reply_at = coalesce\(author_reply_at, v_now\)/iu
  );
  assert.doesNotMatch(migration, /create table public\.comment_replies/iu);
  assert.match(
    migration,
    /b\.blocker_user_id = v_uid and b\.blocked_user_id = v_comment_user_id/iu
  );
  assert.match(
    migration,
    /b\.blocker_user_id = v_comment_user_id and b\.blocked_user_id = v_uid/iu
  );
  assert.match(migration, /message='DIRECT_INTERACTION_UNAVAILABLE'/u);
  assert.match(migration, /author_reply_visible/iu);
});

test('comment feed keeps hidden reasons private while preserving reader-safe presentation', () => {
  assert.match(
    migration,
    /case when v_uid = v_author_id then q\.author_hidden_reason else null end/iu
  );
  assert.match(
    migration,
    /c\.author_hidden_at is null[\s\S]*or v_uid = c\.user_id[\s\S]*or v_uid = v_author_id/iu
  );
  assert.match(migration, /'is_pinned'/u);
  assert.match(migration, /'is_hidden'/u);
  assert.match(migration, /'author_reply_body'/u);
});

test('reader UI exposes moderation only when the feed grants author capability', () => {
  assert.match(commentsRuntime, /comment\.can_moderate !== true/u);
  assert.match(commentsRuntime, /novelight_set_comment_pin/u);
  assert.match(commentsRuntime, /novelight_set_comment_hidden/u);
  assert.match(commentsRuntime, /novelight_set_comment_author_reply/u);
  assert.match(commentsRuntime, /元コメントとSCOUT履歴は削除されません/u);
  assert.match(commentsRuntime, /作者からの返信/u);
  assert.match(commentsRuntime, /作者固定/u);
  assert.match(commentsRuntime, /非表示中のコメントには返信できません/u);
  assert.match(commentsCss, /novelight-comment-author-reply/u);
  assert.match(commentsCss, /novelight-comment-moderation/u);
});

test('B #14 remains outside Rank, LIGHT SEED, PV, favorites, and exposure', () => {
  assert.match(
    migration,
    /Never used as Rank, SCOUT, PV, favorites, discovery, or exposure input/iu
  );
  assert.doesNotMatch(
    migration,
    /recalculate_work_rank|send_light_seed|novel_exposure_events|favorite_count|update\s+public\.novels[\s\S]*?\bpv\s*=/iu
  );
});

test('migration ships with precheck, postcheck, private audit checks, and guarded rollback', () => {
  assert.match(
    precheck,
    /PRECHECK PASS: B #14 author comment moderation prerequisites are ready/u
  );
  assert.match(
    postcheck,
    /POSTCHECK PASS: B #14 moderation is owner-only, audited, soft, and evaluation-neutral/u
  );
  assert.match(postcheck, /has_function_privilege/iu);
  assert.match(postcheck, /has_table_privilege/iu);
  assert.match(
    rollback,
    /ROLLBACK REFUSED: B #14 moderation audit events exist/u
  );
  assert.match(
    rollback,
    /ROLLBACK REFUSED: B #14 moderation state exists on comments/u
  );
  assert.match(
    rollback,
    /Restore the block\/mute-aware comment feed that existed immediately before B #14/u
  );
});

test('migration replay restores later comment safety overrides after Chapter 38 rollback verification', () => {
  const chapter38Replay = migrationReplay.indexOf(
    'Verify Chapter 38 comment SCOUT EXP rollback and replay'
  );
  const restoreSafety = migrationReplay.indexOf(
    'Restore post-Chapter-38 user safety comment runtime'
  );
  const b14Verify = migrationReplay.indexOf(
    'Verify B #14 author comment moderation'
  );

  assert.ok(chapter38Replay > -1);
  assert.ok(restoreSafety > chapter38Replay);
  assert.ok(b14Verify > restoreSafety);
  assert.match(
    migrationReplay,
    /supabase\/rollback\/20260917020000_user_block_mute_rollback\.sql[\s\S]*supabase\/migrations\/20260917020000_user_block_mute\.sql/u
  );
  assert.match(
    migrationReplay,
    /Verify B #14 author comment moderation[\s\S]*20260918192000_comment_author_moderation_rollback\.sql[\s\S]*20260918192000_comment_author_moderation\.sql/u
  );
});

test('moderation lock ordering is deadlock-safe and self-comments stay outside author moderation', () => {
  for (const fn of [
    'novelight_set_comment_pin',
    'novelight_set_comment_hidden'
  ]) {
    const start = migration.indexOf(`create or replace function public.${fn}`);
    const next = migration.indexOf(
      'create or replace function public.',
      start + 1
    );
    const body = migration.slice(start, next === -1 ? migration.length : next);
    const advisory = body.indexOf('pg_advisory_xact_lock');
    const rowLock = body.indexOf('for update of c');

    assert.ok(start > -1);
    assert.ok(advisory > -1);
    assert.ok(
      rowLock > advisory,
      `${fn} must take the work-level advisory lock before the row lock`
    );
    assert.match(
      body,
      /v_comment_user_id = v_uid[\s\S]*Only reader comments can be moderated/iu
    );
  }
});
