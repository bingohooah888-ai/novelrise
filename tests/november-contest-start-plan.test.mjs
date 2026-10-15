import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTEST_START_PREFIX,
  buildContestStartSql,
  verifyContestStartApproval
} from '../scripts/november-contest-start-plan.mjs';

const MAIN = 'a'.repeat(40);

function makeContext(patch = {}, envelope = {}) {
  const p = {
    version: 1,
    operation: 'start-november-contest',
    requestId: 'contest-start-test-request-0001',
    mainSha: MAIN,
    contestKey: 'novelight-november-2026',
    termsVersion: 'november-2026-v1',
    termsUrl: 'https://novelight.jp/contest-terms',
    issuedAt: '2026-10-31T15:00:00Z',
    expiresAt: '2026-10-31T15:10:00Z',
    challenge: 'AAAAAAAA',
    confirmation: 'CHAT_CONTEST_START_APPROVED',
    attestations: {
      registrationOpenVerified: true,
      entryDeadlineVerified: true,
      scoringSafetyReviewed: true,
      readingEndpointConfigVerified: true,
      guestSecretVerified: true,
      operatorReady: true
    },
    ...patch
  };
  return {
    repository: 'bingohooah888-ai/novelrise',
    issueNumber: 2120,
    commentAuthor: 'bingohooah888-ai',
    authorAssociation: 'OWNER',
    commentId: 123456,
    commentBody: CONTEST_START_PREFIX + JSON.stringify(p),
    currentMainSha: MAIN,
    now: '2026-10-31T15:01:00Z',
    ...envelope
  };
}

test('explicit fresh owner approval creates inert single-DO SQL only', () => {
  const approved = verifyContestStartApproval(makeContext());
  assert.equal(approved.productionMutationPerformed, false);
  const sql = buildContestStartSql(approved);
  assert.match(sql, /^do \$novelight_contest_start\$$/m);
  assert.match(sql, /status='active'/);
  assert.match(sql, /for update;/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /registration_open/);
  assert.match(sql, /no eligible entry/);
  assert.match(sql, /now_at < c.starts_at/);
  assert.match(sql, /now_at >= c.starts_at \+ interval '1 day'/);
  assert.match(sql, /STEP12_START_BLOCKED/);
  assert.match(sql, /github-comment-123456/);
  assert.match(sql, /insert into public.novelight_contest_review_audit/);
  assert.doesNotMatch(sql, /^begin;|^commit;/im);
  assert.doesNotMatch(
    sql,
    /novelight_contest_awards\s+set|novelight_contest_rank_snapshots\s+set/i
  );
  assert.match(sql, /\$novelight_contest_start\$;\n$/);
});

test('ordinary approvals, wrong owner, or stale main cannot start contest', () => {
  for (const ctx of [
    makeContext({}, { commentBody: 'はい' }),
    makeContext({}, { commentBody: '本番承認' }),
    makeContext({}, { commentAuthor: 'attacker' }),
    makeContext({}, { authorAssociation: 'NONE' }),
    makeContext({}, { issueNumber: 1837 }),
    makeContext({}, { currentMainSha: 'b'.repeat(40) }),
    makeContext({ confirmation: 'CHAT_CONTEST_REGISTRATION_APPROVED' }),
    makeContext({ operation: 'open-november-contest-registration' }),
    makeContext({ termsVersion: 'november-2026-v2' }),
    makeContext({ challenge: 'DEADBEEF' })
  ]) {
    assert.throws(() => verifyContestStartApproval(ctx), /STEP12_START_BLOCKED/);
  }
});

test('unverified endpoint, missing or extra attestation and expired approvals fail closed', () => {
  const base = makeContext();
  const att = JSON.parse(
    base.commentBody.slice(CONTEST_START_PREFIX.length)
  ).attestations;
  for (const p of [
    { attestations: { ...att, readingEndpointConfigVerified: false } },
    { attestations: { ...att, extra: true } },
    { attestations: { operatorReady: true } },
    { issuedAt: '2026-10-31T15:15:00Z' },
    { expiresAt: '2026-10-31T16:00:00Z' }
  ]) {
    assert.throws(
      () => verifyContestStartApproval(makeContext(p)),
      /STEP12_START_BLOCKED/
    );
  }
  assert.throws(
    () =>
      verifyContestStartApproval(
        makeContext({}, { now: '2026-10-31T15:11:00Z' })
      ),
    /STEP12_START_BLOCKED/
  );
  assert.throws(
    () => buildContestStartSql({ approvalVerified: false }),
    /STEP12_START_BLOCKED/
  );
});
