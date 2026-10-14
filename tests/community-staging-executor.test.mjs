import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCommunityCandidateAdmission,
  COMMUNITY_PREFIX
} from '../scripts/community-staging-approval-gate.mjs';
import {
  COMMUNITY_CANDIDATE_ARTIFACTS,
  composeCommunityRollbackOnlySQL
} from '../scripts/community-staging-transaction.mjs';

const mainSha = 'a40dcf9a0cc7a841c95c075aa448ec794f4fb470';
const headSha = '6ab6c5d91c40d74cd56f5a13c8286acd813de46b';

function good() {
  const payload = {
    scope: 'community-phase1-isolated',
    mainSha,
    candidateSha: headSha,
    migration: '20261014052000',
    confirmation: 'STAGING APPROVED'
  };
  return {
    repository: 'bingohooah888-ai/novelrise',
    issue: {
      number: 294,
      title: '[Staging Control] Supabase migration sync',
      user: { login: 'bingohooah888-ai' }
    },
    comment: {
      id: 2222,
      user: { login: 'bingohooah888-ai' },
      author_association: 'OWNER',
      body: COMMUNITY_PREFIX + JSON.stringify(payload)
    },
    main: { object: { sha: mainSha } },
    pr: {
      number: 2222,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main', sha: mainSha },
      head: { sha: headSha }
    },
    compare: {
      status: 'ahead',
      ahead_by: 2,
      behind_by: 0,
      base_commit: { sha: mainSha },
      head_commit: { sha: headSha }
    },
    ledgerPages: [[]]
  };
}

function reject(inputs, expression) {
  assert.throws(() => assertCommunityCandidateAdmission(inputs), expression);
}

test('a valid offline admission requires exact OWNER and SHA evidence', () => {
  const result = assertCommunityCandidateAdmission(good());
  assert.equal(result.migrationVersion, '20261014052000');
  assert.equal(result.candidateSha, headSha);
  assert.equal(result.requestCommentId, '2222');
});

test('previously consumed requests are rejected too', () => {
  const input = good();
  const spent = {
    requestCommentId: '2222',
    mainSha,
    candidateSha: headSha,
    runId: '777',
    result: 'success'
  };
  const marker = 'NOVELIGHT_STAGING_COMMUNITY_CONSUMED ';
  input.ledgerPages = [[{ body: marker + JSON.stringify(spent) }]];
  reject(input, /already claimed or consumed/u);
});

test('forged author, scope, and branch changes fail closed', () => {
  const a = good();
  a.comment.author_association = 'MEMBER';
  reject(a, /OWNER issue comment/u);
  const b = good();
  b.pr.draft = false;
  reject(b, /open, draft/u);
  const c = good();
  c.compare.status = 'diverged';
  reject(c, /proven descendant/u);
  const d = good();
  d.main.object.sha = 'f'.repeat(40);
  reject(d, /target SHA or scope drift/u);
});

test('previously claimed, incomplete, or malformed ledger is rejected', () => {
  const a = good();
  const marker = 'NOVELIGHT_STAGING_COMMUNITY_CLAIMED ';
  const claim = {
    requestCommentId: '2222',
    mainSha,
    candidateSha: headSha,
    runId: '777'
  };
  a.ledgerPages = [[{ body: marker + JSON.stringify(claim) }]];
  reject(a, /already claimed or consumed/u);
  const b = good();
  b.ledgerPages = [new Array(100).fill({ body: 'filler' })];
  reject(b, /pagination incomplete/u);
  const c = good();
  c.ledgerPages = [[{ body: marker + '{bad json}' }]];
  reject(c, /invalid approval JSON/u);
});

test('all submitted SQL objects are pinned to reviewed blob IDs', () => {
  assert.equal(COMMUNITY_CANDIDATE_ARTIFACTS.length, 4);
  for (const artifact of COMMUNITY_CANDIDATE_ARTIFACTS) {
    assert.match(artifact.blob, /^[a-f0-9]{40}$/u);
    assert.match(artifact.path, /community.plaza.phase1/iu);
  }
});

test('transaction wrapper is stripped and final rollback is mandatory', () => {
  const fragments = [
    '\\set ON_ERROR_STOP on\nBEGIN;\nSELECT 1;\nROLLBACK;',
    'BEGIN;\nSELECT 2;\nCOMMIT;',
    'BEGIN;\nSELECT 3;\nROLLBACK;',
    'BEGIN;\nSELECT 4;\nROLLBACK;'
  ];
  const script = composeCommunityRollbackOnlySQL(fragments);
  assert.equal((script.match(/^BEGIN;$/gmu) ?? []).length, 1);
  assert.equal((script.match(/^ROLLBACK;$/gmu) ?? []).length, 1);
  assert.equal((script.match(/^COMMIT;$/gmu) ?? []).length, 0);
  assert.match(script, /SET LOCAL lock_timeout/u);
});

test('nested commits, metacommands and missing boundaries fail closed', () => {
  const fragments = [
    'BEGIN;\nSELECT 1;\nROLLBACK;',
    'BEGIN;\nSELECT 2;\nCOMMIT;',
    'BEGIN;\nSELECT 3;\nROLLBACK;',
    'BEGIN;\nSELECT 4;\nROLLBACK;'
  ];
  const bad = [...fragments];
  bad[1] += '\nCOMMIT;';
  assert.throws(
    () => composeCommunityRollbackOnlySQL(bad),
    /exact BEGIN\/closing wrapper/u
  );
  const injected = [...fragments];
  injected[3] = 'BEGIN;\n\\! echo unsafe\nROLLBACK;';
  assert.throws(
    () => composeCommunityRollbackOnlySQL(injected),
    /psql metacommand forbidden/u
  );
});

test('staging admission is isolated while DB operations share migration lock', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const path = resolve(
    root,
    '.github/workflows/community-staging-candidate-transaction.yml'
  );
  const source = readFileSync(path, 'utf8');
  const [preamble, jobs] = source.split('\njobs:\n');
  assert.match(preamble, /group: novelight-community-staging-admission-/u);
  assert.doesNotMatch(preamble, /group: supabase-staging-migration-sync/u);
  const transaction = jobs.split('\n  transaction:\n')[1];
  assert.ok(transaction);
  const beforeRecord = transaction.split('\n  record:\n')[0];
  assert.match(
    beforeRecord,
    /group: supabase-staging-migration-sync\n      cancel-in-progress: false/u
  );
  assert.equal(
    (source.match(/group: supabase-staging-migration-sync/gmu) ?? []).length,
    1
  );
});
