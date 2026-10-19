import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import { verifyCommunityHostedReadOnlyPreCostProposal } from '../scripts/community-hosted-precost-review-only.mjs';
import { REVIEWED_COMMUNITY_FILES } from '../scripts/community-phase1-reviewed-candidate.mjs';
import { HOSTED_SCOPE } from '../scripts/community-hosted-write-admission.mjs';

const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const REPO = 'bingohooah888-ai/novelrise';
const ISSUE_URL = 'https://api.github.com/repos/' + REPO + '/issues/188';

function fixture() {
  const proposal = {
    confirmation: 'STAGING COST APPROVED',
    featureSha: HEAD,
    mainSha: MAIN,
    scope: HOSTED_SCOPE,
    target: 'new-data-less-isolated-branch'
  };
  const issue = {
    id: 999,
    number: 188,
    state: 'open',
    url: ISSUE_URL,
    title: '[Staging Approval Control] Preview / Staging cost gate',
    user: { login: 'bingohooah888-ai' }
  };
  const comment = {
    id: 123,
    user: { login: 'bingohooah888-ai' },
    author_association: 'OWNER',
    body:
      'NOVELIGHT_STAGING_COMMUNITY_HOSTED_PRE_COST_APPROVE ' +
      JSON.stringify(proposal)
  };
  return {
    event: {
      action: 'created',
      repository: { full_name: REPO },
      issue,
      comment
    },
    liveIssue: { ...issue },
    main: { object: { sha: MAIN } },
    feature: {
      number: 2222,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main', sha: MAIN },
      head: { sha: HEAD, repo: { full_name: REPO } }
    },
    compare: {
      status: 'ahead',
      behind_by: 0,
      ahead_by: 1,
      total_commits: 1,
      base_commit: { sha: MAIN },
      commits: [{ sha: HEAD }],
      files: REVIEWED_COMMUNITY_FILES.map(({ path, sha, status }) => ({
        filename: path,
        sha,
        status
      }))
    },
    ledgerPages: [[comment]],
    runId: '456'
  };
}

function rejected(change) {
  const value = fixture();
  change(value);
  assert.throws(
    () => verifyCommunityHostedReadOnlyPreCostProposal(value),
    /COMMUNITY_HOSTED_PRE_COST_DENIED/u
  );
}

test('reviewed content permits only preparation', () => {
  const result = verifyCommunityHostedReadOnlyPreCostProposal(fixture());
  assert.equal(result.status, 'OWNER_PRE_COST_PROPOSAL_PREPARATION_ONLY');
  for (const key of [
    'liveEvidenceVerified',
    'stagingCostApproved',
    'mayClaim',
    'mayCreateBranch',
    'mayDeployPreview',
    'mayRunBrowser',
    'runAuthorized',
    'releaseAuthorized'
  ]) {
    assert.equal(result[key], false, key);
  }
});

test('closed, forged or mismatched live issue is denied', () => {
  rejected((x) => {
    x.event.issue.state = 'closed';
  });
  rejected((x) => {
    x.liveIssue.state = 'closed';
  });
  rejected((x) => {
    x.liveIssue.id = 1;
  });
  rejected((x) => {
    x.liveIssue.url = 'https://invalid.example/188';
  });
  rejected((x) => {
    x.event.comment.author_association = 'MEMBER';
  });
});

test('stale blobs and replayed ledger reject', () => {
  rejected((x) => {
    x.compare.files[0].sha = 'f'.repeat(40);
  });
  rejected((x) => {
    x.compare.files.pop();
  });
  rejected((x) => {
    x.compare.behind_by = 1;
  });
  rejected((x) => {
    x.feature.base.sha = 'f'.repeat(40);
  });
  rejected((x) => {
    x.feature.head.sha = 'f'.repeat(40);
  });
  rejected((x) => {
    x.ledgerPages = [];
  });
  rejected((x) => {
    x.compare.files.push({
      filename: 'extra.js',
      sha: 'f'.repeat(40),
      status: 'added'
    });
  });
});

test('new main and head require the same reviewed file blobs', () => {
  const x = fixture();
  const updatedMain = 'c'.repeat(40);
  const updatedHead = 'd'.repeat(40);
  x.main.object.sha = updatedMain;
  x.feature.base.sha = updatedMain;
  x.feature.head.sha = updatedHead;
  x.compare.base_commit.sha = updatedMain;
  x.compare.commits[0].sha = updatedHead;
  const prefix = 'NOVELIGHT_STAGING_COMMUNITY_HOSTED_PRE_COST_APPROVE ';
  const p = JSON.parse(x.event.comment.body.slice(prefix.length));
  p.mainSha = updatedMain;
  p.featureSha = updatedHead;
  x.event.comment.body = prefix + JSON.stringify(p);
  const verdict = verifyCommunityHostedReadOnlyPreCostProposal(x);
  assert.equal(verdict.mainSha, updatedMain);
  assert.equal(verdict.candidateSha, updatedHead);
  assert.equal(verdict.stagingCostApproved, false);
});

test('read-only inspection cannot grant hosted writes', () => {
  const workflow = readFileSync(
    new URL(
      '../.github/workflows/community-hosted-precost-inspection.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(
    workflow,
    /community-hosted-precost-review-only\.mjs validate/u
  );
  assert.match(workflow, /community-precost-reviewed-compare\.json/u);
  for (const token of [
    'contents: read',
    'issues: read',
    'pull-requests: read',
    "github.event.issue.state == 'open'"
  ]) {
    assert.ok(workflow.includes(token));
  }
  for (const forbidden of [
    'environment: staging',
    'issues: write',
    'contents: write',
    'secrets.',
    'gh api -X',
    'npx vercel'
  ]) {
    assert.ok(!workflow.includes(forbidden), forbidden);
  }
  const legacy = readFileSync(
    new URL(
      '../scripts/community-hosted-precost-admission.mjs',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(
    legacy,
    /const FEATURE_SHA = '6bf0ea608183e4977fcdaa17d36b1712974d5a49'/u
  );
});
