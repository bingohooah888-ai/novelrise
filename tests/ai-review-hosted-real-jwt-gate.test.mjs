import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import {
  APPROVAL_PREFIX,
  verifyAIHostedJwtAdmission
} from '../.github/staging-ai-jwt/admission.mjs';
import { assertJwtGate } from '../.github/staging-ai-jwt/runner.mjs';

const MAIN = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const OWNER = 'bingohooah888-ai';
const BASE = 'b725b796f5a4cd51b5181b75e247bfc0502e9568';
const FILES = [
  '.github/staging-ai-jwt/admission.mjs',
  '.github/staging-ai-jwt/probe.mjs',
  '.github/staging-ai-jwt/runner.mjs',
  '.github/workflows/ai-review-hosted-staging-jwt-proof.yml',
  'tests/ai-review-hosted-real-jwt-gate.test.mjs'
];

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
      base_commit: { sha: BASE },
      total_commits: 1,
      commits: [{ sha: CANDIDATE }]
    },
    mainLineage: {
      status: 'ahead',
      behind_by: 0,
      base_commit: { sha: BASE },
      total_commits: 1,
      commits: [{ sha: MAIN }],
      files: FILES.map((filename) => ({ filename, status: 'added' }))
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

test('reject unrelated changed files on trusted main', () => {
  const input = sample();
  input.mainLineage.files.push({
    filename: 'api/ai-owner-bible-review.js',
    status: 'modified'
  });
  assert.throws(() => verifyAIHostedJwtAdmission(input), /DENIED/u);
});

test('reject candidate rebased onto new main after Preview was pinned', () => {
  const input = sample();
  input.compare.base_commit.sha = MAIN;
  assert.throws(() => verifyAIHostedJwtAdmission(input), /DENIED/u);
});

test('reject a missing trusted runner main promotion', () => {
  const input = sample();
  input.mainLineage.status = 'identical';
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

// These two assertions deliberately keep this Draft's CI RED until a reviewed
// trusted-runner fix provides mandatory Auth session cleanup and exact-ID
// deletion protection. The connected GitHub write tool refused that change.
// Do not weaken or skip these tests to make the PR appear deployable.
test('BLOCKER: runner supplies mandatory session revocation callback', () => {
  const runner = readFileSync(
    new URL('../.github/staging-ai-jwt/runner.mjs', import.meta.url),
    'utf8'
  );
  assert.match(
    runner,
    /probeRealHostedJwt\(config,\s*proofEnv,\s*async\s*\(/u
  );
  assert.match(runner, /auth\.admin\.signOut/u);
});

test('BLOCKER: runner checks exact synthetic account before deletion', () => {
  const runner = readFileSync(
    new URL('../.github/staging-ai-jwt/runner.mjs', import.meta.url),
    'utf8'
  );
  assert.match(runner, /created\.app_metadata\?\.internal_e2e/u);
  assert.match(runner, /created\.id\s*!==\s*ID/u);
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
