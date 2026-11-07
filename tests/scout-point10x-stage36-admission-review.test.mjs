import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEW_OWNER_MARKER,
  PROPOSED_LEDGER_REF,
  STAGING_LIVE_ENABLED,
  parseNewScopeOwnerBody,
  inspectNewOwnerGitHubFacts,
  planGitHubNonforceLedgerSpend,
  decideRecoveryReview,
  executeTrustedStagingCutover
} from '../scripts/scout-point10x-stage36-admission-review.mjs';
import {
  CUTOVER_SCOPE,
  SOURCE_SQL_SHA256,
  STAGING_REF,
  PRODUCTION_REF
} from '../scripts/scout-point10x-staging-cutover-adapter.mjs';

const ownerId = 317436651;
const login = 'bingohooah888-ai';
const repo = 'bingohooah888-ai/novelrise';
const mainSha = 'c'.repeat(40);
const digest = 'f'.repeat(64);
const issueUrl = 'https://api.github.com/repos/' + repo + '/issues/294';
const canonical = (obj) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, obj[k]])
    )
  );

function fixture(now = Date.now()) {
  const created = new Date(now - 60_000).toISOString();
  const body =
    NEW_OWNER_MARKER +
    '\n' +
    canonical({
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
      issueNumber: 294,
      mainSha,
      ownerId,
      repo,
      runCount: 1,
      scope: CUTOVER_SCOPE,
      sqlSha256: SOURCE_SQL_SHA256,
      stagingRef: STAGING_REF
    });
  return {
    repo: {
      full_name: repo,
      owner: { id: ownerId, login },
      default_branch: 'main'
    },
    issue: {
      number: 294,
      state: 'open',
      repository_url: 'https://api.github.com/repos/' + repo,
      comments: 3
    },
    comment: {
      id: 107,
      user: { id: ownerId, login },
      author_association: 'OWNER',
      created_at: created,
      updated_at: created,
      issue_url: issueUrl,
      body
    },
    trigger: {
      repository: repo,
      issueNumber: 294,
      commentId: 107,
      eventName: 'issue_comment',
      action: 'created',
      actorId: ownerId,
      actorLogin: login,
      runAttempt: 1,
      workflowRef:
        repo +
        '/.github/workflows/scout-point10x-staging-cutover.yml@refs/heads/main',
      checkoutSha: mainSha
    },
    mainRef: { ref: 'refs/heads/main', object: { sha: mainSha } },
    mainRefAfter: { ref: 'refs/heads/main', object: { sha: mainSha } },
    allCommentIds: [101, 105, 107],
    now: new Date(now).toISOString()
  };
}
function ledger() {
  return {
    ref: PROPOSED_LEDGER_REF,
    headSha: 'e'.repeat(40),
    completeHistoryVerified: true,
    branchProtectionVerified: true,
    spentCommentIds: [102]
  };
}

test('new OWNER scope excludes read-only V3 and cannot be forged by an extra field', () => {
  const x = fixture();
  const parsed = parseNewScopeOwnerBody(x.comment.body);
  assert.equal(parsed.scope, CUTOVER_SCOPE);
  assert.equal(parsed.sqlSha256, SOURCE_SQL_SHA256);
  assert.throws(
    () => parseNewScopeOwnerBody('NOVELIGHT_POINT10X_READONLY_OWNER_V3\n{}'),
    /NEW_SCOPE_MARKER_REQUIRED/
  );
  assert.throws(
    () => parseNewScopeOwnerBody(x.comment.body + ' '),
    /OWNER_CANONICAL_SCHEMA/
  );
  const changed = { ...parsed, runCount: 2 };
  assert.throws(
    () => parseNewScopeOwnerBody(NEW_OWNER_MARKER + '\n' + canonical(changed)),
    /OWNER_SCOPE_OR_SQL_DRIFT/
  );
  const extra = { ...parsed, oldApproval: true };
  assert.throws(
    () => parseNewScopeOwnerBody(NEW_OWNER_MARKER + '\n' + canonical(extra)),
    /OWNER_CANONICAL_SCHEMA/
  );
  const prod = { ...parsed, stagingRef: PRODUCTION_REF };
  assert.throws(
    () => parseNewScopeOwnerBody(NEW_OWNER_MARKER + '\n' + canonical(prod)),
    /OWNER_SCOPE_OR_SQL_DRIFT/
  );
});

test('future trusted event shape is checked, but never authenticates or authorizes itself', () => {
  const verdict = inspectNewOwnerGitHubFacts(fixture());
  assert.equal(verdict.status, 'NO_GO_GITHUB_REST_SHAPE_ONLY');
  assert.equal(verdict.commentId, 107);
  assert.equal(verdict.mainSha, mainSha);
  assert.equal(verdict.realGitHubAuthenticated, false);
  assert.equal(verdict.spentConsumed, false);
  assert.equal(verdict.mayOpenDatabase, false);
  assert.equal(STAGING_LIVE_ENABLED, false);
});

test('edited, impersonated, old, wrong workflow or stale main events are rejected', () => {
  const mutations = [
    (f) => {
      f.comment.updated_at = new Date().toISOString();
    },
    (f) => {
      f.comment.user.id = 1;
    },
    (f) => {
      f.trigger.actorId = 1;
    },
    (f) => {
      f.trigger.action = 'edited';
    },
    (f) => {
      f.trigger.runAttempt = 2;
    },
    (f) => {
      f.trigger.workflowRef =
        repo + '/.github/workflows/scout-point10x-readonly.yml@refs/heads/main';
    },
    (f) => {
      f.mainRefAfter.object.sha = 'a'.repeat(40);
    },
    (f) => {
      f.allCommentIds = [101, 105, 105];
    },
    (f) => {
      f.issue.comments = 9;
    },
    (f) => {
      f.now = new Date(
        Date.parse(f.comment.created_at) + 30 * 60_000
      ).toISOString();
    },
    (f) => {
      f.comment.body = 'FAKE_COMMENT';
    }
  ];
  for (const mutate of mutations) {
    const v = fixture();
    mutate(v);
    assert.throws(
      () => inspectNewOwnerGitHubFacts(v),
      /POINT10X_STAGE36_HOLD:/
    );
  }
});

test('GitHub ledger CAS is only a nonforce proposal, never a durable spent claim', () => {
  const ownerReview = inspectNewOwnerGitHubFacts(fixture());
  const planned = planGitHubNonforceLedgerSpend({
    ownerReview,
    ledger: ledger()
  });
  assert.equal(planned.ref, PROPOSED_LEDGER_REF);
  assert.equal(planned.force, false);
  assert.equal(planned.expectedParentSha, 'e'.repeat(40));
  assert.equal(planned.proposedSpentId, 107);
  assert.match(planned.claimDigest, /^[0-9a-f]{64}$/u);
  assert.equal(planned.actualCASAttempted, false);
  assert.equal(planned.durableOneUseSpent, false);
  assert.equal(planned.automaticRetryAllowed, false);
  assert.equal(planned.mayOpenDatabase, false);
  const duplicate = ledger();
  duplicate.spentCommentIds.push(107);
  assert.throws(
    () => planGitHubNonforceLedgerSpend({ ownerReview, ledger: duplicate }),
    /APPROVAL_ALREADY_SPENT/
  );
});

test('ledger branch protection, complete history and digest shape remain mandatory', () => {
  const ownerReview = inspectNewOwnerGitHubFacts(fixture());
  for (const [key, value] of [
    ['completeHistoryVerified', false],
    ['branchProtectionVerified', false],
    ['headSha', 'unverified'],
    ['ref', 'refs/heads/main'],
    ['spentCommentIds', [101, 101]]
  ]) {
    const corrupted = ledger();
    corrupted[key] = value;
    assert.throws(
      () => planGitHubNonforceLedgerSpend({ ownerReview, ledger: corrupted }),
      /LEDGER_ATTESTATION_MISSING/,
      key
    );
  }
  assert.throws(
    () =>
      planGitHubNonforceLedgerSpend({
        ownerReview: { ...ownerReview, realGitHubAuthenticated: true },
        ledger: ledger()
      }),
    /UNTRUSTED_CLAIM_FOR_LEDGER/
  );
  assert.ok(digest);
});

test('commit-unknown or abort never retries or resumes writers', () => {
  const unknown = decideRecoveryReview({
    outcome: 'commit-ack-unknown',
    primaryMarker: 'verified-singleton',
    ledgerSpent: true,
    independentPostcheck: true
  });
  assert.equal(unknown.status, 'HOLD_READ_PRIMARY_AND_LEDGER');
  assert.equal(unknown.retryAllowed, false);
  assert.equal(unknown.resumeWriters, false);
  assert.equal(unknown.requireIndependentPrimaryRead, true);
  const abort = decideRecoveryReview({ outcome: 'before-commit-aborted' });
  assert.equal(abort.status, 'HOLD_VERIFY_ROLLBACK_AND_WRITER_FENCE');
  assert.equal(abort.resumeWriters, false);
  const incomplete = decideRecoveryReview({ outcome: 'commit-ack-success' });
  assert.equal(incomplete.status, 'HOLD_POSTCOMMIT_EVIDENCE_INCOMPLETE');
  const complete = decideRecoveryReview({
    outcome: 'commit-ack-success',
    primaryMarker: 'verified-singleton',
    ledgerSpent: true,
    independentPostcheck: true
  });
  assert.equal(complete.status, 'NO_GO_OFFLINE_REVIEW_ONLY');
  assert.equal(complete.resumeWriters, false);
  assert.equal(complete.requiresSeparateVerifiedResume, true);
});

test('live Staging entrypoint always HOLDs, even with synthetic complete proof', async () => {
  await assert.rejects(
    executeTrustedStagingCutover({
      force: true,
      secret: 'fake',
      allowed: true
    }),
    /NO_LIVE_EXECUTION_OR_STAGING_APPROVAL/
  );
});
