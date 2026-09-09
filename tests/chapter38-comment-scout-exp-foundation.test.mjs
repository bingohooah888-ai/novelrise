import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath =
  'supabase/migrations/20260910070000_chapter38_comment_scout_exp_foundation.sql';
const precheckPath =
  'supabase/checks/20260910070000_chapter38_comment_scout_exp_foundation_precheck.sql';
const postcheckPath =
  'supabase/checks/20260910070000_chapter38_comment_scout_exp_foundation_postcheck.sql';
const rollbackPath =
  'supabase/rollback/20260910070000_chapter38_comment_scout_exp_foundation_rollback.sql';

function has(text, token) {
  assert.equal(text.includes(token), true);
}

test('comment EXP keeps the MASTER reward and daily work cap', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, "'comment'");
  has(sql, "'beta-v1'");
  has(sql, "timezone('Asia/Tokyo'");
  has(sql, 'daily_order <= 3');
  has(sql, 'v_awarded_today < 3');
  has(sql, "        5,\n        'beta-v1'");
});

test('same work can receive comment EXP only once per JST day', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, 'e.novel_id_snapshot');
  has(sql, "e.event_type = 'comment_posted'");
  has(sql, 'work_day_order = 1');
  has(sql, 'not v_had_work_today');
  has(sql, 'novelight:comment-xp:');
});

test('comment runtime is RPC-only for clients', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, 'alter table public.novel_comments enable row level security');
  has(sql, 'revoke all on table public.novel_comments from public, anon, authenticated');
  has(sql, 'grant execute on function public.novelight_comment_feed');
  has(sql, 'grant execute on function public.post_novel_comment');
  has(sql, 'grant execute on function public.delete_novel_comment');
});

test('checks enforce replay and privilege boundaries', async () => {
  const precheck = await readFile(precheckPath, 'utf8');
  const postcheck = await readFile(postcheckPath, 'utf8');
  has(precheck, 'Existing comment SCOUT EXP requires manual reconciliation');
  has(postcheck, 'Clients must not access novel_comments directly');
  has(postcheck, 'Comment XP daily work cap exceeded');
  has(postcheck, 'A user/work/JST-day received comment XP more than once');
  has(postcheck, 'Comment XP ledger does not match replayable beta rules');
  has(postcheck, 'except select source_event_id from actual');
  has(postcheck, 'except select source_event_id from expected');
});

test('rollback preserves comments and raw comment evidence', async () => {
  const sql = await readFile(rollbackPath, 'utf8');
  has(sql, 'delete from public.scout_xp_ledger');
  has(sql, "x.xp_kind = 'comment'");
  has(sql, 'drop function public.post_novel_comment');
  assert.equal(sql.includes('delete from public.scout_event_ledger'), false);
  assert.equal(sql.includes('drop table public.novel_comments'), false);
  assert.equal(/truncate/i.test(sql), false);
});
