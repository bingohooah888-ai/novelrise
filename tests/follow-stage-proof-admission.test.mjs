import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PREFIX, CLAIM, CONSUMED, verifyFollowStageApproval
} from '../scripts/follow-stage-proof-admission.mjs';

const mainSha = '0'.repeat(40);
const headSha = '1'.repeat(40);
const owner = 'bingohooah888-ai';

function fixture() {
  const request = {
    scope: 'follow-preview-real-jwt',
    mainSha,
    candidateSha: headSha,
    pr: 2698,
    stagingProject: 'wmlzjgvxgoyrovdhbqbg',
    migration: '20261031173000',
    executionCount: 1,
    confirmation: 'STAGING FOLLOW PROOF APPROVED'
  };
  return {
    event: {
      repository: { full_name: owner + '/novelrise' },
      issue: { number: 294 },
      sender: { login: owner },
      comment: {
        id: 17, user: { login: owner },
        author_association: 'OWNER',
        body: PREFIX + JSON.stringify(request)
      }
    },
    issue: {
      number: 294,
      state: 'open',
      title: '[Staging Control] Supabase migration sync',
      user: { login: owner }
    },
    main: { object: { sha: mainSha } },
    pr: {
      number: 2698,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main', sha: mainSha },
      head: {
        ref: 'feat/following-list-bookshelf-community-20261031',
        sha: headSha,
        repo: { full_name: owner + '/novelrise' }
      }
    },
    compare: {
      status: 'ahead',
      behind_by: 0,
      base_commit: { sha: mainSha },
      commits: [{ sha: headSha }],
      total_commits: 1
    },
    pages: [[]]
  };
}

function expectDenied(value) {
  assert.throws(
    () => verifyFollowStageApproval(value),
    /FOLLOW_STAGE_PROOF_DENIED/u
  );
}

test('only exact current SHA and OWNER approval is eligible', () => {
  const current = fixture();
  const result = verifyFollowStageApproval(current);
  assert.equal(result.mainSha, mainSha);
  assert.equal(result.candidateSha, headSha);
  assert.equal(result.requestCommentId, '17');
  assert.equal(result.stagingProject, 'wmlzjgvxgoyrovdhbqbg');
});

test('scope, project, count or SHA mismatch fails closed', () => {
  for (const [key, value] of [
    ['scope', 'preview-only'],
    ['stagingProject', 'fiepaguycecrredwrcwx'],
    ['executionCount', 2],
    ['candidateSha', '2'.repeat(40)]
  ]) {
    const f = fixture();
    const request = JSON.parse(f.event.comment.body.slice(PREFIX.length));
    request[key] = value;
    f.event.comment.body = PREFIX + JSON.stringify(request);
    expectDenied(f);
  }
});

test('draft, base, branch, OWNER or Issue changes fail closed', () => {
  for (const change of [
    (f) => { f.pr.draft = false; },
    (f) => { f.pr.base.sha = 'f'.repeat(40); },
    (f) => { f.pr.head.ref = 'feature/elsewhere'; },
    (f) => { f.event.comment.user.login = 'other'; },
    (f) => { f.issue.state = 'closed'; },
    (f) => { f.compare.behind_by = 1; }
  ]) {
    const f = fixture();
    change(f);
    expectDenied(f);
  }
});

test('claimed or consumed approval cannot be replayed', () => {
  for (const prefix of [CLAIM, CONSUMED]) {
    const f = fixture();
    const used = {
      requestCommentId: '17', mainSha,
      candidateSha: headSha, runId: '42'
    };
    if (prefix === CONSUMED) used.result = 'success';
    f.pages = [[{ body: prefix + JSON.stringify(used) }]];
    expectDenied(f);
  }
});

test('incomplete ledger pagination fails closed', () => {
  const f = fixture();
  f.pages = [Array.from({ length: 100 }, () => ({ body: 'unrelated' }))];
  expectDenied(f);
});
