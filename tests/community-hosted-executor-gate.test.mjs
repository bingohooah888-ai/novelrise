import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import {
  inspectCommunityHostedExecutorPreclaim
} from '../scripts/community-hosted-executor-gate.mjs';
import {
  HOSTED_PRE_COST_APPROVE
} from '../scripts/community-hosted-precost-admission.mjs';
import {
  HOSTED_CLAIMED,
  HOSTED_SCOPE
} from '../scripts/community-hosted-write-admission.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const OWNER = 'bingohooah888-ai';
const MAIN = 'a'.repeat(40);
const CANDIDATE = '6bf0ea608183e4977fcdaa17d36b1712974d5a49';
const ISSUE_URL = 'https://api.github.com/repos/' + REPO + '/issues/188';

function fixture() {
  const comment = {
    id: 123,
    issue_url: ISSUE_URL,
    created_at: '2026-10-18T01:00:00Z',
    updated_at: '2026-10-18T01:00:00Z',
    author_association: 'OWNER',
    user: { login: OWNER },
    body:
      HOSTED_PRE_COST_APPROVE +
      JSON.stringify({
        confirmation: 'STAGING COST APPROVED',
        featureSha: CANDIDATE,
        mainSha: MAIN,
        scope: HOSTED_SCOPE,
        target: 'new-data-less-isolated-branch'
      })
  };
  const issue = {
    id: 999,
    number: 188,
    url: ISSUE_URL,
    title: '[Staging Approval Control] Preview / Staging cost gate',
    user: { login: OWNER }
  };
  const event = {
    action: 'created',
    repository: { full_name: REPO },
    issue: { ...issue },
    comment: { ...comment }
  };
  return {
    environment: {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'issue_comment',
      GITHUB_REPOSITORY: REPO,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_WORKFLOW_REF:
        REPO +
        '/.github/workflows/community-hosted-executor.yml@refs/heads/main',
      GITHUB_ACTOR: OWNER,
      GITHUB_TRIGGERING_ACTOR: OWNER,
      GITHUB_RUN_ID: '456',
      GITHUB_SHA: MAIN
    },
    checkedOutSha: MAIN,
    issue,
    comment,
    event,
    main: { object: { sha: MAIN } },
    feature: {
      number: 2222,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main' },
      head: { sha: CANDIDATE, repo: { full_name: REPO } }
    },
    ledgerPages: [[comment]]
  };
}

test('exact OWNER preclaim is read-only and grants no execution', () => {
  const receipt = inspectCommunityHostedExecutorPreclaim(fixture());
  assert.equal(
    receipt.status,
    'COMMUNITY_HOSTED_EXECUTOR_PRECLAIM_READONLY_ONLY'
  );
  assert.equal(receipt.trustedMainSha, MAIN);
  assert.equal(receipt.candidateSha, CANDIDATE);
  assert.equal(receipt.requestCommentId, '123');
  assert.equal(receipt.runId, '456');
  assert.equal(receipt.ownerEvidenceVerified, true);
  assert.equal(receipt.exactApprovalSnapshotVerified, true);
  for (const field of [
    'claimAuthorized',
    'stagingCostApproved',
    'runAuthorized',
    'writeAuthorized',
    'releaseAuthorized',
    'mayCreateBranch',
    'mayDeployPreview',
    'mayRunBrowser'
  ]) {
    assert.equal(receipt[field], false, field);
  }
  assert.ok(Object.isFrozen(receipt));
});

test('owner identity, event, SHA drift and used approval fail closed', () => {
  const cases = [
    (x) => {
      x.environment.GITHUB_ACTOR = 'other';
    },
    (x) => {
      x.environment.GITHUB_TRIGGERING_ACTOR = 'other';
    },
    (x) => {
      x.environment.GITHUB_WORKFLOW_REF = 'wrong';
    },
    (x) => {
      x.environment.GITHUB_SHA = 'b'.repeat(40);
    },
    (x) => {
      x.event.action = 'edited';
    },
    (x) => {
      x.event.issue.id = 998;
    },
    (x) => {
      x.comment.body += 'tampered';
    },
    (x) => {
      x.comment.updated_at = '2026-10-18T02:00:00Z';
    },
    (x) => {
      x.main.object.sha = 'b'.repeat(40);
    },
    (x) => {
      x.feature.head.sha = 'b'.repeat(40);
    },
    (x) => {
      x.feature.draft = false;
    },
    (x) => {
      x.ledgerPages = [];
    },
    (x) => {
      x.ledgerPages = [
        [
          x.comment,
          {
            id: 124,
            body:
              HOSTED_CLAIMED +
              JSON.stringify({
                requestCommentId: '123',
                mainSha: MAIN,
                featureSha: CANDIDATE,
                runId: '321'
              })
          }
        ]
      ];
    }
  ];
  for (const mutate of cases) {
    const data = fixture();
    mutate(data);
    assert.throws(
      () => inspectCommunityHostedExecutorPreclaim(data),
      /DENIED/u
    );
  }
});

test('workflow cannot claim, write or run paid Staging', () => {
  const source = readFileSync(
    new URL(
      '../.github/workflows/community-hosted-executor.yml',
      import.meta.url
    ),
    'utf8'
  );
  for (const required of [
    'issue_comment:',
    'types: [created]',
    'cancel-in-progress: false',
    'github.triggering_actor',
    'persist-credentials: false',
    'community-hosted-executor-gate.mjs inspect',
    'mayDeployPreview == false',
    'claimAuthorized == false'
  ]) {
    assert.ok(source.includes(required), required);
  }
  for (const forbidden of [
    'contents: write',
    'issues: write',
    'workflow_dispatch',
    'workflow_call:',
    'environment: staging',
    'secrets.',
    'gh api -X POST',
    'community-hosted-claim-entry.mjs claim',
    'community-hosted-claim-only.yml',
    'SUPABASE_ACCESS_TOKEN',
    'VERCEL_API_TOKEN',
    'npx vercel',
    'supabase db'
  ]) {
    assert.ok(!source.includes(forbidden), forbidden);
  }
});
