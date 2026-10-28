import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPROVAL_PREFIX,
  CLAIM_PREFIX,
  CONSUMED_PREFIX,
  verifyAIHostedRaceAdmission
} from '../scripts/ai-review-hosted-proof-admission.mjs';

const M = 'a'.repeat(40);
const C = 'b'.repeat(40);
const OWNER = 'bingohooah888-ai';

function fixture() {
  const request = {
    scope: 'candidate-db-race-proof',
    mainSha: M,
    candidateSha: C,
    pr: 2601,
    migration: '20261028084410',
    stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
    confirmation: 'STAGING APPROVED'
  };
  const comment = {
    id: 70001,
    user: { login: OWNER },
    author_association: 'OWNER',
    body: APPROVAL_PREFIX + JSON.stringify(request)
  };
  return {
    repository: OWNER + '/novelrise',
    issue: {
      number: 294,
      state: 'open',
      title: '[Staging Control] Supabase migration sync',
      user: { login: OWNER }
    },
    comment,
    actor: OWNER,
    triggeringActor: OWNER,
    main: { object: { sha: M } },
    pr: {
      number: 2601,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main', sha: M },
      head: {
        ref: 'codex/ai020704-staging-candidate-db-20261028',
        sha: C,
        repo: { full_name: OWNER + '/novelrise' }
      }
    },
    compare: {
      status: 'ahead',
      behind_by: 0,
      base_commit: { sha: M },
      total_commits: 1,
      commits: [{ sha: C }]
    },
    ledgerPages: [[comment]]
  };
}

function rejects(label, mutate) {
  test(label, () => {
    const input = fixture();
    mutate(input);
    assert.throws(
      () => verifyAIHostedRaceAdmission(input),
      /AI_STAGING_RACE_PROOF_DENIED/u
    );
  });
}

test('one exact OWNER Staging race-proof request returns immutable pins', () => {
  const decision = verifyAIHostedRaceAdmission(fixture());
  assert.equal(decision.stagingProjectRef, 'wmlzjgvxgoyrovdhbqbg');
  assert.equal(decision.requestCommentId, '70001');
  assert.equal(decision.fixtureNovel, 998891001);
  assert.equal(decision.fixtureEpisode, 998891002);
  assert.equal(Object.isFrozen(decision), true);
});

rejects('a generic approval is not a race-proof approval', (input) => {
  input.comment.body = input.comment.body.replace(
    'candidate-db-race-proof',
    'candidate-db-persist'
  );
});
rejects('a different environment is refused', (input) => {
  input.comment.body = input.comment.body.replace(
    'wmlzjgvxgoyrovdhbqbg',
    'fiepaguycecrredwrcwx'
  );
});
rejects('a non-OWNER or different triggering actor is refused', (input) => {
  input.triggeringActor = 'untrusted-actor';
});
rejects('a changed current main is refused', (input) => {
  input.main.object.sha = 'c'.repeat(40);
});
rejects('a changed PR head is refused', (input) => {
  input.pr.head.sha = 'd'.repeat(40);
});
rejects('a foreign repository PR is refused', (input) => {
  input.pr.head.repo.full_name = 'other/repository';
});
rejects('a non-draft PR is refused', (input) => {
  input.pr.draft = false;
});
rejects('a behind-main PR is refused', (input) => {
  input.compare.behind_by = 1;
});
rejects('a missing approval in ledger is refused', (input) => {
  input.ledgerPages = [[]];
});
rejects('a partially paginated ledger is refused', (input) => {
  input.ledgerPages = [
    Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      body: 'filler'
    }))
  ];
});
rejects('an approval that was claimed cannot be reused', (input) => {
  input.ledgerPages[0].push({
    id: 70002,
    body:
      CLAIM_PREFIX +
      JSON.stringify({
        requestCommentId: '70001',
        mainSha: M,
        candidateSha: C,
        runId: '555'
      })
  });
});
rejects('a consumed approval cannot be reused', (input) => {
  input.ledgerPages[0].push({
    id: 70003,
    body:
      CONSUMED_PREFIX +
      JSON.stringify({
        requestCommentId: '70001',
        mainSha: M,
        candidateSha: C,
        runId: '555',
        result: 'failure'
      })
  });
});
rejects('extra approval fields are refused', (input) => {
  const body = JSON.parse(input.comment.body.slice(APPROVAL_PREFIX.length));
  body.previewUrl = 'https://evil.invalid';
  input.comment.body = APPROVAL_PREFIX + JSON.stringify(body);
});
rejects('duplicated approval entries are refused', (input) => {
  input.ledgerPages[0].push({ ...input.comment });
});
