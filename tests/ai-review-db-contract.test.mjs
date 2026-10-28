// Offline contract checks only: these do not substitute for PostgreSQL
// two-session races or authenticated HTTP/JWT end-to-end testing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sqlPath = 'reports/sql/novelight_ai_review_candidates_PROPOSAL.sql';
const reviewerPath = 'api/_lib/ai/novel-bible-inference-review.js';
const sql = readFileSync(sqlPath, 'utf8');
const reviewer = readFileSync(reviewerPath, 'utf8');

function functionBody(name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `unterminated ${name}`);
  return sql.slice(start, end);
}

test('02-07-04: staging is owner-locked', () => {
  const batch = functionBody('novelight_ai_review_stage_batch');
  assert.match(batch, /current_user\s*<>\s*'service_role'/i);
  assert.match(batch, /n\.user_id\s*=\s*p_actor_id/i);
  assert.match(batch, /for share of e, n/i);
  assert.match(batch, /v_current_hash is distinct from p_source_hash/i);
  assert.match(batch, /pg_advisory_xact_lock/i);
  assert.match(batch, /strpos\(v_body, v_candidate ->> 'evidence'\) = 0/i);
  assert.match(batch, /raise exception/i);
});

test('02-07-04: decisions use pending CAS', () => {
  const decide = functionBody('novelight_ai_review_decide');
  assert.match(decide, /current_user\s*<>\s*'service_role'/i);
  assert.match(decide, /for share of e, n/i);
  assert.match(decide, /v_current_hash is distinct from p_source_hash/i);
  assert.match(decide, /c\.revision\s*=\s*p_expected_revision/i);
  assert.match(decide, /c\.status\s*=\s*'pending'/i);
  assert.match(decide, /revision\s*=\s*c\.revision\s*\+\s*1/i);
  assert.match(decide, /n\.user_id\s*=\s*p_actor_id/i);
});

test('02-07-04: browser roles are blocked', () => {
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

test('02-07-04: AI cannot confirm canon', () => {
  assert.match(reviewer, /requiresAuthorReview:\s*true/);
  assert.match(reviewer, /episode\.content\.includes\(evidence\)/);
  assert.doesNotMatch(reviewer, /provenance:\s*'author_confirmed'/);
});

// These PostgreSQL digests were obtained from the isolated staging database
// with to_json(title)::text / to_json(body)::text and extensions.digest.
// No schema mutation or manuscript data was involved.
test('02-07-04: staging PostgreSQL and Node source hashes agree', () => {
  const vectors = [
    ['題名', '本文', '9c75b5ea7a918989290ff9e6553947a9642e5b21c3d2e5357df89bb1bfdb13ad'],
    ['A', 'line\nnext', 'e7927c331bc484adb17b76f4a624c112910be78eff3cef377a20e6f02b612818'],
    ['絵文字😀', '引用"と逆斜線\\', 'ed1134bd20fc529319822191a876b07a8a85209dec0fb7d20ff98ae47d0fe96a'],
  ];
  assert.match(sql, /pg_catalog\.to_json\(v_title\)::text/i);
  assert.match(sql, /pg_catalog\.to_json\(v_body\)::text/i);
  for (const [title, body, expected] of vectors) {
    const actual = createHash('sha256').update(JSON.stringify([title, body])).digest('hex');
    assert.equal(actual, expected);
  }
});
