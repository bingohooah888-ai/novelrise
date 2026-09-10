import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260910143000_chapter38_exclude_self_comment_scout_exp.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260910143000_chapter38_exclude_self_comment_scout_exp_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260910143000_chapter38_exclude_self_comment_scout_exp_rollback.sql',
  'utf8'
);
const replay = await readFile('scripts/run-migration-replay.sh', 'utf8');

function has(text, token) {
  assert.equal(
    text.includes(token),
    true,
    `expected SQL to include ${token}`
  );
}

test('runtime snapshots self-comment EXP eligibility and author identity', () => {
  has(migration, 'v_is_self_comment := v_author_id = v_uid');
  has(migration, "'novel_author_id', v_author_id");
  has(migration, "'xp_eligible', not v_is_self_comment");
  has(migration, 'if not v_is_self_comment and not v_had_work_today then');
});

test('replay rebuild excludes self-comments before applying the daily cap', () => {
  has(migration, "when e.metadata ? 'xp_eligible'");
  has(
    migration,
    'when n.id is not null then e.user_id is distinct from n.user_id'
  );
  has(migration, 'from eligible_events e');
  has(migration, 'where e.xp_eligible');
  has(migration, 'where d.daily_order <= 3');
});

test('postcheck rejects self-comment EXP and replay drift', () => {
  has(postcheck, 'Self-comment SCOUT EXP is present after migration');
  has(
    postcheck,
    'Comment XP ledger does not match self-comment-safe replay rules'
  );
});

test('rollback restores the prior beta-v1 comment replay behavior', () => {
  assert.equal(rollback.includes('v_is_self_comment'), false);
  has(rollback, "where e.event_type = 'comment_posted'");
  has(rollback, 'where d.daily_order <= 3');
});

test('migration replay exercises hardening rollback and restores current rules', () => {
  has(replay, 'Verify Chapter 38 self-comment exclusion rollback and reapply');
  const applyCount =
    replay.split(
      'supabase/migrations/20260910143000_chapter38_exclude_self_comment_scout_exp.sql'
    ).length - 1;
  assert.ok(
    applyCount >= 2,
    'self-comment hardening must be reapplied after rollback'
  );
});
