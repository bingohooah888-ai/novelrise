import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSTED_APPROVE,
  HOSTED_CLAIMED,
  HOSTED_CONSUMED,
  HOSTED_SCOPE,
  verifyCommunityHostedApproval
} from '../scripts/community-hosted-write-admission.mjs';

const MAIN = 'a'.repeat(40);
const FEATURE = '6bf0ea608183e4977fcdaa17d36b1712974d5a49';
const PROJECT = 'cccccccccccccccccccc';
const PREVIEW = 'https://isolated-community-preview.vercel.app';
const REF = 'fiepaguycecrredwrcwx';
const request = {
  scope: HOSTED_SCOPE,
  mainSha: MAIN,
  featureSha: FEATURE,
  previewSha: FEATURE,
  previewUrl: PREVIEW,
  supabaseProjectRef: PROJECT,
  confirmation: 'STAGING APPROVED'
};
const userIds = {
  author: 'c0a00000-0000-4000-8000-000000000001',
  reader: 'c0a00000-0000-4000-8000-000000000002',
  admin: 'c0a00000-0000-4000-8000-000000000003'
};

function input() {
  return {
    repository: 'bingohooah888-ai/novelrise',
    issue: {
      number: 188,
      title: '[Staging Approval Control] Preview / Staging cost gate',
      user: { login: 'bingohooah888-ai' }
    },
    comment: {
      id: 123,
      user: { login: 'bingohooah888-ai' },
      author_association: 'OWNER',
      body: HOSTED_APPROVE + JSON.stringify(request)
    },
    main: { object: { sha: MAIN } },
    pr: {
      number: 2222,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main' },
      head: {
        sha: FEATURE,
        repo: { full_name: 'bingohooah888-ai/novelrise' }
      }
    },
    branch: {
      project_ref: PROJECT,
      parent_project_ref: REF,
      preview_project_status: 'ACTIVE_HEALTHY'
    },
    preview: {
      vercelEnv: 'preview',
      commitSha: FEATURE,
      appBaseUrl: PREVIEW,
      supabase: { url: 'https://' + PROJECT + '.supabase.co' }
    },
    userIds,
    ledgerPages: [[]]
  };
}

function rejects(change) {
  const row = input();
  change(row);
  assert.throws(() => verifyCommunityHostedApproval(row), /DENIED/u);
}

test('valid shape is still preparation-only, never execution approval', () => {
  const result = verifyCommunityHostedApproval(input());
  assert.equal(result.status, 'OWNER_APPROVAL_VALIDATED_PREPARATION_ONLY');
  assert.equal(result.runAuthorized, false);
  assert.equal(result.writeAuthorized, false);
  assert.equal(result.releaseAuthorized, false);
  assert.equal(result.requestCommentId, '123');
  assert.ok(Object.isFrozen(result));
});

test('owner, exact current main and immutable Draft PR are required', () => {
  rejects((x) => {
    x.comment.author_association = 'MEMBER';
  });
  rejects((x) => {
    x.issue.number = 294;
  });
  rejects((x) => {
    x.main.object.sha = 'd'.repeat(40);
  });
  rejects((x) => {
    x.pr.head.sha = 'e'.repeat(40);
  });
  rejects((x) => {
    x.pr.draft = false;
  });
  rejects((x) => {
    x.pr.state = 'closed';
  });
});

test('separate scope, SHA, Preview and isolated branch are checked', () => {
  rejects((x) => {
    x.comment.body = HOSTED_APPROVE + JSON.stringify({
      ...request,
      scope: 'community-phase1-interaction-rollback'
    });
  });
  rejects((x) => {
    x.branch.project_ref = 'wmlzjgvxgoyrovdhbqbg';
  });
  rejects((x) => {
    x.branch.parent_project_ref = 'wrong';
  });
  rejects((x) => {
    x.branch.preview_project_status = 'CREATING_PROJECT';
  });
  rejects((x) => {
    x.preview.commitSha = 'f'.repeat(40);
  });
  rejects((x) => {
    x.preview.vercelEnv = 'production';
  });
  rejects((x) => {
    x.preview.supabase.url = 'https://wrong.supabase.co';
  });
  rejects((x) => {
    x.userIds.reader = x.userIds.author;
  });
});

test('claimed and consumed approvals cannot be reused', () => {
  for (const prefix of [HOSTED_CLAIMED, HOSTED_CONSUMED]) {
    rejects((x) => {
      const row = {
        requestCommentId: '123',
        mainSha: MAIN,
        featureSha: FEATURE,
        runId: '77'
      };
      if (prefix === HOSTED_CONSUMED) row.result = 'failure';
      x.ledgerPages = [[{ body: prefix + JSON.stringify(row) }]];
    });
  }
});

test('truncated and malformed ledger or unrecognized fields fail shut', () => {
  rejects((x) => {
    x.ledgerPages = [Array(100).fill({ body: '' })];
  });
  rejects((x) => {
    x.ledgerPages = [];
  });
  rejects((x) => {
    x.ledgerPages = [[null]];
  });
  rejects((x) => {
    x.comment.body = HOSTED_APPROVE + JSON.stringify({
      ...request,
      injected: true
    });
  });
});
