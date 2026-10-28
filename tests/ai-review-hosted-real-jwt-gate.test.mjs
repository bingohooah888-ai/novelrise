import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  APPROVAL_PREFIX,
  verifyAIHostedJwtAdmission
} from '../.github/staging-ai-jwt/admission.mjs';
import { assertJwtGate } from '../.github/staging-ai-jwt/runner.mjs';

const MAIN = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const OWNER = 'bingohooah888-ai';

function sample() {
  const approval = {
    scope: 'real-auth-jwt-preview-proof',
    mainSha: MAIN,
    candidateSha: CANDIDATE,
    pr: 2601,
    migration: '20261028084410',
    stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
    deploymentId: 'dpl_6DF1tKxfwYMmqJC7dU2qFAHT6D83',
    previewHost: 'novelrise-bzrnrif4v-ranobe1.vercel.app',
    confirmation: 'STAGING APPROVED'
  };
  const comment = {
    id: 123,
    user: { login: OWNER },
    author_association: 'OWNER',
    body: APPROVAL_PREFIX + JSON.stringify(approval)
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
    main: { object: { sha: MAIN } },
    pr: {
      number: 2601,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main', sha: MAIN },
      head: {
        ref: 'codex/ai020704-staging-candidate-db-20261028',
        sha: CANDIDATE,
        repo: { full_name: OWNER + '/novelrise' }
      }
    },
    compare: {
      status: 'ahead',
      behind_by: 0,
      base_commit: { sha: MAIN },
      total_commits: 1,
      commits: [{ sha: CANDIDATE }]
    },
    ledgerPages: [[comment]]
  };
}

test('JWT approval is pinned to owner, Staging and Preview', () => {
  const input = sample();
  const admitted = verifyAIHostedJwtAdmission(input);
  assert.equal(admitted.fixtureNovel, 998891003);
  assert.equal(admitted.fixtureOwner, '00000000-0000-4000-8000-000000000943');
  input.comment.body = input.comment.body.replace('dpl_6DF1', 'dpl_WRONG');
  assert.throws(() => verifyAIHostedJwtAdmission(input), /DENIED/u);
});

test('an already claimed one-use JWT approval is rejected', () => {
  const input = sample();
  const claim = {
    requestCommentId: '123',
    mainSha: MAIN,
    candidateSha: CANDIDATE,
    runId: '1'
  };
  input.ledgerPages[0].push({
    body: 'NOVELIGHT_STAGING_AI_JWT_PROOF_CLAIMED ' + JSON.stringify(claim)
  });
  assert.throws(() => verifyAIHostedJwtAdmission(input), /DENIED/u);
});

test('runner requires dedicated Staging approval and secrets', () => {
  assert.throws(() => assertJwtGate({}), /DENIED/u);
});

test('runner uses official Auth Admin APIs, not auth.users SQL', () => {
  const src = readFileSync(
    new URL('../.github/staging-ai-jwt/runner.mjs', import.meta.url),
    'utf8'
  );
  assert.match(src, /auth\.admin\.createUser/u);
  assert.match(src, /auth\.admin\.deleteUser/u);
  assert.doesNotMatch(src, /insert\s+into\s+auth\.users/iu);
  assert.doesNotMatch(src, /fiepaguycecrredwrcwx/u);
  assert.match(src, /fkResidue/u);
});

test('workflow requires OWNER and a single-use Staging ledger', () => {
  const src = readFileSync(
    new URL(
      '../.github/workflows/ai-review-hosted-staging-jwt-proof.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(src, /issue_comment:/u);
  assert.match(src, /author_association == 'OWNER'/u);
  assert.match(src, /NOVELIGHT_STAGING_AI_JWT_PROOF_APPROVE/u);
  assert.match(src, /NOVELIGHT_STAGING_AI_JWT_PROOF_CLAIMED/u);
  assert.match(src, /NOVELIGHT_STAGING_AI_JWT_PROOF_CONSUMED/u);
  assert.match(src, /environment: staging/u);
  assert.doesNotMatch(src, /workflow_dispatch:/u);
});
