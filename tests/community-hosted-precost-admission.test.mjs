import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import {
  HOSTED_PRE_COST_APPROVE,
  verifyCommunityHostedPreCostAdmission
} from '../scripts/community-hosted-precost-admission.mjs';
import { REVIEWED_COMMUNITY_FILES } from '../scripts/community-phase1-reviewed-candidate.mjs';
import {
  HOSTED_APPROVE,
  HOSTED_CLAIMED,
  HOSTED_CONSUMED,
  HOSTED_SCOPE
} from '../scripts/community-hosted-write-admission.mjs';

const MAIN = 'a'.repeat(40);
const FEATURE = 'b'.repeat(40);
const RUN = '456';
const proposal = {
  scope: HOSTED_SCOPE,
  mainSha: MAIN,
  featureSha: FEATURE,
  target: 'new-data-less-isolated-branch',
  confirmation: 'STAGING COST APPROVED'
};

function proposalBody(changes = {}) {
  const request = { ...proposal, ...changes };
  return HOSTED_PRE_COST_APPROVE + JSON.stringify(request);
}

function fixture() {
  const input = {
    event: {
      action: 'created',
      repository: { full_name: 'bingohooah888-ai/novelrise' },
      issue: {
        id: 999,
        number: 188,
        state: 'open',
        url: 'https://api.github.com/repos/bingohooah888-ai/novelrise/issues/188',
        title: '[Staging Approval Control] Preview / Staging cost gate',
        user: { login: 'bingohooah888-ai' }
      },
      comment: {
        id: 123,
        user: { login: 'bingohooah888-ai' },
        author_association: 'OWNER',
        body: proposalBody()
      }
    },
    main: { object: { sha: MAIN } },
    feature: {
      number: 2222,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main', sha: MAIN },
      head: {
        sha: FEATURE,
        repo: { full_name: 'bingohooah888-ai/novelrise' }
      }
    },
    compare: {
      status: 'ahead',
      behind_by: 0,
      ahead_by: 1,
      total_commits: 1,
      base_commit: { sha: MAIN },
      commits: [{ sha: FEATURE }],
      files: REVIEWED_COMMUNITY_FILES.map((f) => ({
        filename: f.path,
        sha: f.sha,
        status: f.status
      }))
    },
    ledgerPages: [],
    runId: RUN
  };
  input.liveIssue = { ...input.event.issue };
  input.ledgerPages = [[input.event.comment]];
  return input;
}

function rejectField(path, value) {
  const input = fixture();
  const parts = path.split('.');
  const last = parts.pop();
  const parent = parts.reduce((object, key) => object[key], input);
  parent[last] = value;
  assert.throws(
    () => verifyCommunityHostedPreCostAdmission(input),
    /COMMUNITY_HOSTED_PRE_COST_DENIED/u
  );
}

function ledgerRow(marker, requestId, runId) {
  const value = {
    requestCommentId: requestId,
    mainSha: MAIN,
    featureSha: FEATURE,
    runId
  };
  if (marker === HOSTED_CONSUMED) {
    value.result = 'failure';
  }
  return {
    id: 124,
    user: { login: 'github-actions[bot]' },
    body: marker + JSON.stringify(value)
  };
}

test('pre-cost proposal never grants execution', () => {
  const proof = verifyCommunityHostedPreCostAdmission(fixture());
  assert.equal(proof.status, 'OWNER_PRE_COST_PROPOSAL_PREPARATION_ONLY');
  assert.equal(proof.plannedBranchName, 'community-hosted-' + RUN);
  assert.equal(proof.mainSha, MAIN);
  assert.equal(proof.candidateSha, FEATURE);
  assert.equal(proof.requestCommentId, '123');
  for (const flag of [
    'liveEvidenceVerified',
    'stagingCostApproved',
    'mayClaim',
    'mayCreateBranch',
    'mayDeployPreview',
    'mayRunBrowser',
    'runAuthorized',
    'releaseAuthorized'
  ]) {
    assert.equal(proof[flag], false, flag);
  }
  assert.ok(Object.isFrozen(proof));
});

test('only the authentic owner and control issue qualify', () => {
  rejectField('event.action', 'edited');
  rejectField('event.repository.full_name', 'wrong/novelrise');
  rejectField('event.issue.number', 294);
  rejectField('event.issue.state', 'closed');
  rejectField('liveIssue.state', 'closed');
  rejectField('liveIssue.id', 123);
  rejectField('liveIssue.url', 'https://invalid.example/188');
  rejectField('event.issue.title', 'wrong');
  rejectField('event.issue.user.login', 'wrong');
  rejectField('event.issue.pull_request', {});
  rejectField('event.comment.user.login', 'wrong');
  rejectField('event.comment.author_association', 'MEMBER');
  rejectField('event.comment.id', 0);
  rejectField('runId', '0');
  rejectField('runId', '456;drop');
});

test('current main and exact unmerged candidate are fixed', () => {
  rejectField('main.object.sha', 'b'.repeat(40));
  rejectField('feature.head.sha', 'c'.repeat(40));
  rejectField('feature.head.repo.full_name', 'wrong/repo');
  rejectField('feature.draft', false);
  rejectField('feature.merged', true);
  rejectField('feature.state', 'closed');
  rejectField('feature.base.ref', 'other');
  rejectField('feature.base.sha', 'c'.repeat(40));
  rejectField('event.comment.body', proposalBody({ featureSha: 'c'.repeat(40) }));
  rejectField('feature.number', 2223);
  rejectField('event.comment.body', proposalBody({ scope: 'other' }));
  rejectField('event.comment.body', proposalBody({ mainSha: 'invalid' }));
  rejectField('event.comment.body', proposalBody({ target: 'staging' }));
});

test('unrelated approvals and injected JSON are rejected', () => {
  const bad = { ...proposal, operation: 'create-branch' };
  rejectField('event.comment.body', HOSTED_APPROVE);
  rejectField('event.comment.body', HOSTED_PRE_COST_APPROVE + '{');
  rejectField('event.comment.body', proposalBody(bad));
  rejectField('event.comment.body', proposalBody({ confirmation: 'OK' }));
});

test('claimed requests and reused run IDs are rejected', () => {
  for (const marker of [HOSTED_CLAIMED, HOSTED_CONSUMED]) {
    for (const [requestId, runId] of [
      ['123', '77'],
      ['999', RUN]
    ]) {
      const input = fixture();
      input.ledgerPages[0].push(ledgerRow(marker, requestId, runId));
      assert.throws(
        () => verifyCommunityHostedPreCostAdmission(input),
        /COMMUNITY_HOSTED_PRE_COST_DENIED/u
      );
    }
  }
});

test('malformed or incomplete ledger is rejected', () => {
  rejectField('ledgerPages', []);
  rejectField('ledgerPages', [Array(100).fill({ body: '' })]);
  rejectField(
    'ledgerPages',
    Array.from({ length: 21 }, () => [])
  );
  rejectField('ledgerPages', [[null]]);
  rejectField('ledgerPages', [[{ body: HOSTED_CLAIMED + '{' }]]);
  rejectField('ledgerPages', [[ledgerRow(HOSTED_CLAIMED, '123', 'bad')]]);
  const invalid = {
    requestCommentId: '999',
    mainSha: MAIN,
    featureSha: FEATURE,
    runId: '888',
    result: ''
  };
  const text = HOSTED_CONSUMED + JSON.stringify(invalid);
  rejectField('ledgerPages', [[{ body: text }]]);
});

test('owner inspection workflow remains read-only', () => {
  const path = new URL(
    '../.github/workflows/community-hosted-precost-inspection.yml',
    import.meta.url
  );
  const workflow = readFileSync(path, 'utf8');
  for (const required of [
    'issue_comment:',
    'ref: main',
    'persist-credentials: false',
    'contents: read',
    'issues: read',
    'pull-requests: read',
    'community-hosted-precost-admission.mjs validate',
    '/tmp/community-precost-issue.json',
    '/tmp/community-precost-reviewed-compare.json',
    "github.event.issue.state == 'open'",
    '.stagingCostApproved == false',
    '.mayClaim == false',
    '.mayCreateBranch == false',
    '.runAuthorized == false'
  ]) {
    assert.ok(workflow.includes(required), required);
  }
  for (const forbidden of [
    'issues: write',
    'contents: write',
    'secrets.',
    'environment: staging',
    'gh api -X',
    'curl --request',
    'npx vercel',
    'workflow_dispatch',
    'api.supabase.com'
  ]) {
    assert.ok(!workflow.includes(forbidden), forbidden);
  }
});

test('partial pagination or missing OWNER source is rejected', () => {
  const sample = fixture();
  rejectField('ledgerPages', [sample.ledgerPages[0], []]);
  rejectField('ledgerPages', [[]]);
  const fake = {
    ...sample.event.comment,
    body: 'forged'
  };
  rejectField('ledgerPages', [[fake]]);
  rejectField('ledgerPages', [
    [sample.event.comment, { ...sample.event.comment, id: 123 }]
  ]);
});

test('full reviewed blob manifest rejects stale, extra and missing content', () => {
  for (const mutation of [
    (x) => { x.compare.files[0].sha = 'f'.repeat(40); },
    (x) => { x.compare.files.pop(); },
    (x) => {
      x.compare.files.push({
        filename: 'unaudited.js',
        sha: 'f'.repeat(40),
        status: 'added'
      });
    },
    (x) => { x.compare.behind_by = 1; },
    (x) => { x.compare.commits[0].sha = 'f'.repeat(40); },
    (x) => { x.compare.base_commit.sha = 'f'.repeat(40); }
  ]) {
    const input = fixture();
    mutation(input);
    assert.throws(
      () => verifyCommunityHostedPreCostAdmission(input),
      /COMMUNITY_HOSTED_PRE_COST_DENIED/u
    );
  }
});

test('current main and a descendant head pass only as preparation', () => {
  const input = fixture();
  const nextMain = 'c'.repeat(40);
  const nextHead = 'd'.repeat(40);
  input.main.object.sha = nextMain;
  input.feature.base.sha = nextMain;
  input.feature.head.sha = nextHead;
  input.compare.base_commit.sha = nextMain;
  input.compare.commits[0].sha = nextHead;
  const nextBody = proposalBody({ mainSha: nextMain, featureSha: nextHead });
  input.event.comment.body = nextBody;
  input.ledgerPages[0][0].body = nextBody;
  const result = verifyCommunityHostedPreCostAdmission(input);
  assert.equal(result.candidateSha, nextHead);
  assert.equal(result.mainSha, nextMain);
  assert.equal(result.stagingCostApproved, false);
  assert.equal(result.mayClaim, false);
  assert.equal(result.mayCreateBranch, false);
  assert.equal(result.mayDeployPreview, false);
});
