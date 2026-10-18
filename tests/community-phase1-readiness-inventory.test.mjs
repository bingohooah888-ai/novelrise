import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditCommunityPhase1Readiness,
  CANDIDATE_GUARD_PATHS,
  LEGACY_CANDIDATE_SHA
} from '../scripts/community-phase1-readiness-inventory.mjs';

const mainSha = 'a'.repeat(40);
const candidateSha = 'b'.repeat(40);
const sources = (value) => Object.fromEntries(
  CANDIDATE_GUARD_PATHS.map((path) => [path, value])
);

function check(sourceByPath, approvalIssueState = 'closed') {
  return auditCommunityPhase1Readiness({
    mainSha, candidateSha, sourceByPath, approvalIssueState
  });
}

test('old pins remain blocked and no authorization is granted', () => {
  const result = check(sources(LEGACY_CANDIDATE_SHA));
  assert.equal(result.stalePins.length, CANDIDATE_GUARD_PATHS.length);
  assert.ok(result.blockers.includes('STALE_CANDIDATE_SHA_PINS'));
  assert.ok(result.blockers.includes('CONTROL_ISSUE_NOT_CONFIRMED_OPEN'));
  assert.equal(result.mayClaim, false);
  assert.equal(result.mayProvision, false);
  assert.equal(result.safeToMergeProduction, false);
});

test('even current pins and open control state do not grant access', () => {
  const result = check(sources(candidateSha), 'open');
  assert.deepEqual(result.stalePins, []);
  assert.equal(result.currentPins.length, CANDIDATE_GUARD_PATHS.length);
  assert.equal(result.ownerApprovalGranted, false);
  assert.equal(result.stagingCostApproved, false);
  assert.equal(result.mayRunHostedBrowser, false);
  assert.equal(result.mayMutateProduction, false);
  assert.ok(result.blockers.includes(
    'INDEPENDENT_ENVIRONMENT_AND_PROVIDER_SPEND_PROOF_MISSING'
  ));
});

test('a historical pin is flagged even alongside a current pin', () => {
  const result = check(sources(LEGACY_CANDIDATE_SHA + candidateSha));
  assert.equal(result.stalePins.length, CANDIDATE_GUARD_PATHS.length);
});

test('missing and unclassified sources fail closed', () => {
  const incomplete = sources(candidateSha);
  delete incomplete[CANDIDATE_GUARD_PATHS[0]];
  assert.throws(() => check(incomplete), /missing source/u);
  const unclassified = check(sources('no candidate pin'));
  assert.equal(unclassified.unclassified.length, CANDIDATE_GUARD_PATHS.length);
  assert.ok(unclassified.blockers.includes('UNCLASSIFIED_CANDIDATE_GUARDS'));
});

test('bad or obsolete SHA identities are rejected', () => {
  for (const bad of [null, 'X'.repeat(40), mainSha, LEGACY_CANDIDATE_SHA]) {
    assert.throws(() => auditCommunityPhase1Readiness({
      mainSha, candidateSha: bad, sourceByPath: sources('irrelevant')
    }), /invalid or superseded/u);
  }
});
