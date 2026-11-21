import assert from 'node:assert/strict';
import test from 'node:test';
import * as admission from '../scripts/community-phase2-staging-admission-readonly.mjs';
import * as reviewed from '../scripts/community-phase2-staging-reviewed-blobs.mjs';

const MAIN_SHA = 'f6028c77915ffce5f01149cd374d03a3c81dca8f';
const FEATURE_SHA = 'feb1d7728e4d8cef917df52355d873807eba5cc9';

// prettier-ignore
function facts() {
  return {
    repository: 'bingohooah888-ai/novelrise',
    actor: 'bingohooah888-ai',
    checkedOutSha: MAIN_SHA,
    main: { object: { sha: MAIN_SHA } },
    feature: {
      number: 2457,
      state: 'open',
      draft: true,
      base: { ref: 'main' },
      head: {
        sha: FEATURE_SHA,
        ref: 'feat/community-plaza-board-phase2-20261023',
        repo: { full_name: 'bingohooah888-ai/novelrise' }
      }
    },
    featureCommit: {
      sha: FEATURE_SHA,
      tree: { sha: 'a'.repeat(40) }
    },
    featureTree: {
      sha: 'a'.repeat(40),
      truncated: false,
      tree: Object.entries(reviewed.REVIEWED_PHASE2_BLOBS).map(
        ([path, sha]) => ({ path, sha, type: 'blob', mode: '100644' })
      )
    },
    compare: {
      behind_by: 0,
      ahead_by: 90,
      base_commit: { sha: MAIN_SHA },
      commits: [{ sha: FEATURE_SHA }]
    },
    previewLedger: {
      number: 188,
      state: 'open',
      title: '[Staging Approval Control] Preview / Staging cost gate'
    },
    stagingLedger: {
      number: 294,
      state: 'open',
      title: '[Staging Control] Supabase migration sync'
    }
  };
}

// prettier-ignore
test('even green preflight never issues a billable staging grant', () => {
  const actual = admission.inspectPhase2StagingAdmission(facts());
  assert.equal(actual.status, 'PHASE2_READINESS_FACTS_PASSED_NO_EXECUTION');
  for (const key of [
    'stagingCostApproved',
    'ownerOneUseClaimAuthorized',
    'mayReopenLedger',
    'mayCreatePreview',
    'mayCreateBranch',
    'mayRunHostedBrowser',
    'mayChangeProduction',
    'publicReleaseAuthorized'
  ]) {
    assert.equal(actual[key], false, key);
  }
});

// prettier-ignore
test('current closed Preview ledger prevents Phase 2 staging entry', () => {
  const input = facts();
  input.previewLedger.state = 'closed';
  const actual = admission.inspectPhase2StagingAdmission(input);
  assert.equal(actual.status, 'PHASE2_STAGING_ADMISSION_BLOCKED');
  assert.ok(actual.reasons.includes('PREVIEW_LEDGER_CLOSED_OR_MISSING'));
});

// prettier-ignore
test('old Phase 1 PR cannot masquerade as Phase 2', () => {
  const input = facts();
  input.feature.number = 2222;
  const actual = admission.inspectPhase2StagingAdmission(input);
  assert.ok(actual.reasons.includes('WRONG_OR_MISSING_PHASE2_PR'));
});

// prettier-ignore
test('stale candidate, main drift and altered compare all block entry', () => {
  const input = facts();
  input.compare.commits[0].sha = MAIN_SHA;
  input.compare.behind_by = 1;
  input.checkedOutSha = FEATURE_SHA;
  const actual = admission.inspectPhase2StagingAdmission(input);
  assert.ok(actual.reasons.includes('TRUSTED_MAIN_CHECKOUT_MISMATCH'));
  assert.ok(actual.reasons.includes('CANDIDATE_NOT_BASED_ON_CURRENT_MAIN'));
});

// prettier-ignore
test('no non-owner requests and no incomplete Staging ledger', () => {
  const input = facts();
  input.actor = 'attacker';
  input.stagingLedger.state = 'closed';
  const actual = admission.inspectPhase2StagingAdmission(input);
  assert.ok(actual.reasons.includes('OWNER_IDENTITY_MISSING'));
  assert.ok(actual.reasons.includes('STAGING_LEDGER_CLOSED_OR_MISSING'));
});

// prettier-ignore
test('a forged candidate repository fails closed', () => {
  const input = facts();
  input.feature.head.repo.full_name = 'attacker/novelrise';
  const actual = admission.inspectPhase2StagingAdmission(input);
  assert.ok(actual.reasons.includes('WRONG_OR_MISSING_PHASE2_PR'));
});

// prettier-ignore
test('an unreviewed board migration blob is rejected without a write grant', () => {
  const input = facts();
  input.featureTree.tree[0].sha = 'b'.repeat(40);
  const result = admission.inspectPhase2StagingAdmission(input);
  assert.equal(result.status, 'PHASE2_STAGING_ADMISSION_BLOCKED');
  assert.ok(result.reasons.some((reason) =>
    reason.startsWith('UNREVIEWED_PHASE2_BLOB_')));
  assert.equal(result.mayRunHostedBrowser, false);
});

// prettier-ignore
test('truncated or unbound feature tree fails closed', () => {
  const input = facts();
  input.featureTree.truncated = true;
  input.featureTree.sha = 'b'.repeat(40);
  const result = admission.inspectPhase2StagingAdmission(input);
  assert.ok(result.reasons.includes('FEATURE_TREE_TRUNCATED_OR_MISSING'));
  assert.ok(result.reasons.includes('FEATURE_COMMIT_TREE_NOT_VERIFIED'));
});

// prettier-ignore
test('missing isolated three-role acceptance script is rejected', () => {
  const input = facts();
  input.featureTree.tree = input.featureTree.tree.filter(
    (item) => item.path !== 'tests/e2e/staging/community-hosted-auth-write.spec.js'
  );
  const result = admission.inspectPhase2StagingAdmission(input);
  assert.ok(result.reasons.some((reason) =>
    reason.includes('community-hosted-auth-write.spec.js')));
});
