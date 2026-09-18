import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const version = '20260918221621';
const migration = await readFile(
  `supabase/migrations/${version}_comment_spoiler_display.sql`,
  'utf8'
);
const precheck = await readFile(
  `supabase/checks/${version}_comment_spoiler_display_precheck.sql`,
  'utf8'
);
const postcheck = await readFile(
  `supabase/checks/${version}_comment_spoiler_display_postcheck.sql`,
  'utf8'
);
const rollback = await readFile(
  `supabase/rollback/${version}_comment_spoiler_display_rollback.sql`,
  'utf8'
);
const runtime = await readFile('novelight-comments.js', 'utf8');
const css = await readFile('novelight-comments.css', 'utf8');
const replay = await readFile('scripts/run-migration-replay.sh', 'utf8');

test('B #15 extends the existing comment row instead of creating a second comment system', () => {
  assert.match(
    migration,
    /alter table public\.novel_comments[\s\S]*add column is_spoiler boolean not null default false/iu
  );
  assert.doesNotMatch(
    migration,
    /create table public\.(?:comments|spoiler_comments|comment_spoilers)\b/iu
  );
  assert.doesNotMatch(
    migration,
    /drop function(?: if exists)? public\.post_novel_comment\(text,\s*text\)/iu
  );
});

test('spoiler posting atomically reuses the existing safety and SCOUT source of truth', () => {
  assert.match(
    migration,
    /create or replace function public\.novelight_post_novel_comment\([\s\S]*security definer[\s\S]*set search_path = ''/iu
  );
  assert.match(
    migration,
    /v_result := public\.post_novel_comment\(p_novel_id, p_body\)/u
  );
  assert.match(
    migration,
    /update public\.novel_comments[\s\S]*set is_spoiler = v_is_spoiler[\s\S]*id = v_comment_id[\s\S]*user_id = v_uid/iu
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_post_novel_comment\(text, text, boolean\)[\s\S]*to authenticated/iu
  );
  assert.match(
    migration,
    /revoke all on function public\.novelight_post_novel_comment\(text, text, boolean\)[\s\S]*from public, anon, authenticated, service_role/iu
  );
});

test('comment feed preserves B #14 moderation and block/mute behavior while exposing spoiler state', () => {
  for (const token of [
    "'is_spoiler'",
    'author_hidden_at',
    'author_reply_visible',
    'public.user_mutes',
    'public.user_blocks'
  ]) {
    assert.ok(migration.includes(token), `missing feed token: ${token}`);
  }
});

test('reader UI hides spoiler content until explicit reveal and marks composer posts', () => {
  assert.match(runtime, /comment\.is_spoiler === true/u);
  assert.match(runtime, /spoilerContent\.hidden = true/u);
  assert.match(runtime, /aria-expanded/u);
  assert.match(runtime, /ネタバレを表示/u);
  assert.match(runtime, /ネタバレを隠す/u);
  assert.match(runtime, /p_is_spoiler: isSpoiler/u);
  assert.match(runtime, /novelight_post_novel_comment/u);
  assert.match(runtime, /SPOILER_RPC_UNAVAILABLE/u);
  assert.match(
    runtime,
    /if \(result\.error && isMissingRpc\(result\.error\)\)[\s\S]*if \(isSpoiler\)[\s\S]*SPOILER_RPC_UNAVAILABLE[\s\S]*post_novel_comment/iu
  );
  assert.match(css, /novelight-comments-spoiler-option/u);
  assert.match(css, /novelight-comment-spoiler-toggle/u);
  assert.match(css, /novelight-comment-spoiler-content\[hidden\]/u);
});

test('B #15 remains presentation-only and cannot change evaluation or exposure signals', () => {
  assert.match(
    migration,
    /Never used for SCOUT, Rank, PV, favorites, discovery, or exposure/iu
  );
  assert.doesNotMatch(
    migration,
    /recalculate_work_rank|send_light_seed|novel_exposure_events|favorite_count|update\s+public\.novels[\s\S]*?\bpv\s*=/iu
  );
});

test('migration has guarded precheck, postcheck, rollback, and replay coverage', () => {
  assert.match(
    precheck,
    /PRECHECK PASS: B #15 comment spoiler prerequisites are ready/u
  );
  assert.match(
    postcheck,
    /POSTCHECK PASS: B #15 spoiler state is atomic, reader-safe, and evaluation-neutral/u
  );
  assert.match(postcheck, /has_function_privilege/iu);
  assert.match(
    rollback,
    /ROLLBACK REFUSED: B #15 spoiler-marked comments exist/u
  );
  assert.match(
    rollback,
    /Restore the B #14 moderation-aware comment feed without B #15 spoiler state/u
  );
  assert.match(
    replay,
    /Verify B #15 comment spoiler display[\s\S]*20260918221621_comment_spoiler_display_rollback\.sql[\s\S]*20260918221621_comment_spoiler_display\.sql/iu
  );
});

test('spoiler metadata does not change or delete prior comment and SCOUT history', () => {
  assert.doesNotMatch(
    migration,
    /delete from public\.novel_comments|delete from public\.scout_event_ledger|delete from public\.scout_xp_ledger/iu
  );
});
