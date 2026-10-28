// Offline contract checks only: these do not substitute for PostgreSQL
// two-session races or authenticated HTTP/JWT end-to-end testing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL(
    '../reports/sql/novelight_ai_review_candidates_PROPOSAL.sql',
    import.meta.url
  ),
  'utf8'
);
const reviewer = readFileSync(
  new URL('../api/_lib/ai/novel-bible-inference-review.js', import.meta.url),
  'utf8'
);

function functionBody(name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `unterminated ${name}`);
  return sql.slice(start, end);
}

test('02-07-04: batch stages only a current, author-owned locked episode', () => {
  const batch = functionBody('novelight_ai_review_stage_batch');
  assert.match(batch, /current_user\s*<>\s*'service_role'/i);
  assert.match(batch, /n\.user_id\s*=\s*p_actor_id/i);
  assert.match(batch, /for share of e, n/i);
  assert.match(batch, /v_current_hash is distinct from p_source_hash/i);
  assert.match(batch, /pg_advisory_xact_lock/i);
  assert.match(batch, /strpos\(v_body, v_candidate ->> 'evidence'\) = 0/i);
  assert.match(batch, /raise exception/i);
});

test('02-07-04: decisions require an atomic pending revision CAS', () => {
  const decide = functionBody('novelight_ai_review_decide');
  assert.match(decide, /current_user\s*<>\s*'service_role'/i);
  assert.match(decide, /for share of e, n/i);
  assert.match(decide, /v_current_hash is distinct from p_source_hash/i);
  assert.match(decide, /c\.revision\s*=\s*p_expected_revision/i);
  assert.match(decide, /c\.status\s*=\s*'pending'/i);
  assert.match(decide, /revision\s*=\s*c\.revision\s*\+\s*1/i);
  assert.match(decide, /n\.user_id\s*=\s*p_actor_id/i);
});

test('02-07-04: browser roles cannot read candidates or execute review RPCs', () => {
  assert.match(sql, /enable row level security/i);
  const revokes = sql.toLowerCase().match(/revoke all on [^;]+;/g) ?? [];
  const blocked = 'from public, anon, authenticated';
  const table = 'public.novelight_ai_review_candidates';
  function isBlocked(target) {
    return revokes.some((statement) => {
      return statement.includes(target) && statement.includes(blocked);
    });
  }
  assert.ok(isBlocked(table));
  for (const suffix of ['stage_batch', 'decide']) {
    const rpc = `public.novelight_ai_review_${suffix}(`;
    assert.ok(isBlocked(rpc));
  }
});

test('02-07-04: untrusted AI suggestions never self-confirm author canon', () => {
  assert.match(reviewer, /requiresAuthorReview:\s*true/);
  assert.match(reviewer, /episode\.content\.includes\(evidence\)/);
  assert.doesNotMatch(reviewer, /provenance:\s*'author_confirmed'/);
});
