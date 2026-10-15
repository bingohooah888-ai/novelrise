import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTEST_REGISTRATION_PREFIX,
  buildAtomicRegistrationOpenSql,
  expectedRegistrationChallenge,
  verifyRegistrationOpenApproval
} from '../scripts/november-contest-registration-open-plan.mjs';

const TERMS_SHA = 'e1cff58133cc63723e018c0a54b34f3197ce4b9b';
const MAIN_SHA = '93764e4ab50d87b5d7d0f93677b610b599bf8e9f';

function fixture() {
  const approval = {
    version: 1,
    operation: 'open-november-contest-registration',
    requestId: 'contest-regopen-test-request-01',
    mainSha: MAIN_SHA,
    contestKey: 'novelight-november-2026',
    termsVersion: 'november-2026-v1',
    termsUrl: 'https://novelight.jp/contest-terms',
    termsSourceSha: TERMS_SHA,
    termsAdoptionCommentId: 123456,
    issuedAt: '2026-10-14T23:59:00Z',
    expiresAt: '2026-10-15T00:09:00Z',
    challenge: '',
    confirmation: 'CHAT_CONTEST_REGISTRATION_APPROVED',
    attestations: {
      termsAdopted: true,
      legalReviewCompleted: true,
      residentAndNonresidentTaxReviewed: true,
      recipientIdentityAndMailVerified: true,
      personalDataHandlingReviewed: true,
      payoutBudgetConfirmed: true,
      publicSmokeOperatorReady: true
    }
  };
  approval.challenge = expectedRegistrationChallenge(approval);
  return {
    repository: 'bingohooah888-ai/novelrise',
    issueNumber: 2120,
    commentAuthor: 'bingohooah888-ai',
    authorAssociation: 'OWNER',
    commentId: 123457,
    commentBody: CONTEST_REGISTRATION_PREFIX + JSON.stringify(approval),
    currentMainSha: MAIN_SHA,
    currentTermsSourceSha: TERMS_SHA,
    termsAdoptionEvidence: {
      ownerVerified: true,
      commentId: 123456,
      termsSourceSha: TERMS_SHA,
      termsVersion: 'november-2026-v1',
      termsUrl: 'https://novelight.jp/contest-terms'
    },
    now: '2026-10-15T00:00:00Z'
  };
}

function mutatePayload(context, mutation) {
  const payload = JSON.parse(
    context.commentBody.slice(CONTEST_REGISTRATION_PREFIX.length)
  );
  mutation(payload);
  return {
    ...context,
    commentBody: CONTEST_REGISTRATION_PREFIX + JSON.stringify(payload)
  };
}

test('owner approval creates an inert plan', () => {
  const result = verifyRegistrationOpenApproval(fixture());
  assert.equal(result.approvalContractValidated, true);
  assert.equal(result.productionMutationPerformed, false);
  assert.equal(result.mainSha, MAIN_SHA);
  assert.equal(result.termsAdoptionCommentId, 123456);
  assert.equal(Object.isFrozen(result), true);
});

test('ordinary or Production approvals cannot open entry', () => {
  const context = fixture();
  for (const body of [
    'はい',
    '本番承認',
    '受付開始承認',
    'NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_APPROVE {}'
  ]) {
    assert.throws(
      () => verifyRegistrationOpenApproval({ ...context, commentBody: body }),
      /STEP05_APPROVAL_BLOCKED/
    );
  }
  assert.throws(
    () =>
      verifyRegistrationOpenApproval({
        ...context,
        commentAuthor: 'github-actions[bot]'
      }),
    /owner-authored/
  );
  assert.throws(
    () => verifyRegistrationOpenApproval({ ...context, issueNumber: 1837 }),
    /wrong control issue/
  );
  assert.throws(
    () =>
      verifyRegistrationOpenApproval({
        ...context,
        currentMainSha: 'a'.repeat(40)
      }),
    /stale/
  );
});

test('mismatched terms and missing evidence block approval', () => {
  const original = fixture();
  const edits = [
    (p) => {
      p.termsVersion = 'other';
    },
    (p) => {
      p.termsUrl = 'https://example.org/contest';
    },
    (p) => {
      p.termsSourceSha = 'b'.repeat(40);
    },
    (p) => {
      p.challenge = '00000000';
    },
    (p) => {
      p.confirmation = 'CHAT_PRODUCTION_APPROVED';
    },
    (p) => {
      p.attestations.legalReviewCompleted = false;
    },
    (p) => {
      p.attestations.residentAndNonresidentTaxReviewed = false;
    },
    (p) => {
      p.attestations.recipientIdentityAndMailVerified = false;
    },
    (p) => {
      p.extra = true;
    }
  ];
  for (const edit of edits) {
    assert.throws(
      () => verifyRegistrationOpenApproval(mutatePayload(original, edit)),
      /STEP05_APPROVAL_BLOCKED/
    );
  }
  assert.throws(
    () =>
      verifyRegistrationOpenApproval({
        ...original,
        termsAdoptionEvidence: {
          ...original.termsAdoptionEvidence,
          ownerVerified: false
        }
      }),
    /terms-adoption evidence/
  );
});

test('approval has a short validity window', () => {
  const context = fixture();
  assert.throws(
    () =>
      verifyRegistrationOpenApproval({
        ...context,
        now: '2026-10-15T00:10:00Z'
      }),
    /expired/
  );
  assert.throws(
    () =>
      verifyRegistrationOpenApproval({
        ...context,
        now: '2026-10-14T23:58:00Z'
      }),
    /issued in future/
  );
  assert.throws(
    () =>
      verifyRegistrationOpenApproval(
        mutatePayload(context, (p) => {
          p.expiresAt = '2026-10-15T02:00:00Z';
        })
      ),
    /expired/
  );
});

test('release SQL is scoped, atomic and auditable', () => {
  const verified = verifyRegistrationOpenApproval(fixture());
  const sql = buildAtomicRegistrationOpenSql(verified);
  assert.match(sql, /^-- DANGEROUS IF EXECUTED:/);
  // A single DO statement is atomic in PostgreSQL; unlike a payload
  // containing BEGIN/COMMIT it does not rely on API multi-query behavior.
  assert.match(sql, /\ndo \$novelight_stage05_open\$/);
  assert.match(sql, /\n\$novelight_stage05_open\$;\n$/);
  assert.doesNotMatch(sql, /^begin;|^commit;|^set local /im);
  assert.match(sql, /pg_catalog\.set_config\('lock_timeout', '5s', true\)/);
  assert.match(sql, /pg_catalog\.set_config\('statement_timeout', '20s', true\)/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /for update;/);
  assert.match(sql, /public_visible is not false/);
  assert.match(sql, /terms_version not in/);
  assert.match(sql, /v_now >= v_contest.entry_deadline_at/);
  assert.match(sql, /v_now >= v_contest.starts_at/);
  assert.match(
    sql,
    /if exists \(select 1 from public.novelight_contest_entries/
  );
  assert.match(sql, /status = 'registration', public_visible = true/);
  assert.match(sql, /STEP05_REGISTRATION_OPEN_BLOCKED/);
  assert.match(sql, /insert into public.novelight_contest_review_audit/);
  assert.match(sql, /github-comment-123457/);
  assert.doesNotMatch(sql, /novelight_contest_reader_scores\s+set/);
  assert.doesNotMatch(sql, /novelight_contest_awards\s+set/);
  assert.throws(
    () => buildAtomicRegistrationOpenSql({ approvalContractValidated: false }),
    /STEP05_APPROVAL_BLOCKED/
  );
});
