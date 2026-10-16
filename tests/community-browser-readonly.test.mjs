import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCommunityBrowserAdmission,
  FEATURE_MANIFEST,
  REUSE_PREFIX,
  REUSE_SHA,
  REUSE_URL
} from '../scripts/community-browser-readonly-admission.mjs';

const mainSha = 'a'.repeat(40);
const featurePrSha = 'b'.repeat(40);

function validApproval() {
  const payload = {
    scope: 'community-phase1-browser-readonly',
    mainSha,
    candidateSha: REUSE_SHA,
    previewUrl: REUSE_URL,
    featurePrSha,
    confirmation: 'STAGING APPROVED'
  };
  return {
    repository: 'bingohooah888-ai/novelrise',
    issue: {
      number: 188,
      title: '[Staging Approval Control] Preview / Staging cost gate',
      user: { login: 'bingohooah888-ai' }
    },
    comment: {
      id: 17001,
      body: REUSE_PREFIX + JSON.stringify(payload),
      author_association: 'OWNER',
      user: { login: 'bingohooah888-ai' }
    },
    main: { object: { sha: mainSha } },
    pr: {
      number: 2222,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main' },
      head: {
        sha: featurePrSha,
        repo: { full_name: 'bingohooah888-ai/novelrise' }
      }
    },
    prTree: {
      tree: Object.entries(FEATURE_MANIFEST).map(([path, sha]) => ({
        path,
        sha
      })),
      truncated: false
    },
    ledgerPages: [
      [
        {
          user: { login: 'github-actions[bot]' },
          body:
            'NOVELIGHT_STAGING_COMMUNITY_PREVIEW_CONSUMED ' +
            JSON.stringify({
              requestCommentId: '6213881253',
              mainSha: 'c'.repeat(40),
              candidateSha: REUSE_SHA,
              runId: '38889986330',
              result: 'success'
            })
        }
      ]
    ]
  };
}

test('only one immutable approved Preview and matching feature blobs pass', () => {
  const input = validApproval();
  const decision = assertCommunityBrowserAdmission(input);
  assert.equal(decision.candidateSha, REUSE_SHA);
  assert.equal(decision.featurePrSha, featurePrSha);
  assert.equal(decision.previewUrl, REUSE_URL);

  input.prTree.tree[0].sha = 'd'.repeat(40);
  assert.throws(
    () => assertCommunityBrowserAdmission(input),
    /source differs/u
  );
});

test('owner, exact current main and exact Draft PR HEAD are mandatory', () => {
  const input = validApproval();
  input.comment.author_association = 'MEMBER';
  assert.throws(() => assertCommunityBrowserAdmission(input), /DENIED/u);
  input.comment.author_association = 'OWNER';

  input.pr.head.sha = 'd'.repeat(40);
  assert.throws(() => assertCommunityBrowserAdmission(input), /DENIED/u);
  input.pr.head.sha = featurePrSha;

  input.main.object.sha = 'e'.repeat(40);
  assert.throws(() => assertCommunityBrowserAdmission(input), /DENIED/u);
});

test('a consumed or claimed approval cannot be reused', () => {
  const input = validApproval();
  input.ledgerPages[0].push({
    body:
      'NOVELIGHT_STAGING_COMMUNITY_BROWSER_CLAIMED ' +
      JSON.stringify({
        requestCommentId: String(input.comment.id),
        mainSha,
        candidateSha: REUSE_SHA,
        runId: '11'
      })
  });
  assert.throws(
    () => assertCommunityBrowserAdmission(input),
    /already claimed/u
  );
});

test('prior Preview deployment must be ledger-proven successful', () => {
  const input = validApproval();
  input.ledgerPages[0][0].body = input.ledgerPages[0][0].body.replace(
    '"success"',
    '"failure"'
  );
  assert.throws(
    () => assertCommunityBrowserAdmission(input),
    /not ledger-proven/u
  );
});
