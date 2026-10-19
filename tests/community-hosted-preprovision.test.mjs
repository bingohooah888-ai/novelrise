import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import {
  COMMUNITY_HOSTED_PREFLIGHT_MARKER,
  verifyCommunityHostedPreprovision
} from '../scripts/community-hosted-preprovision.mjs';
import {
  REVIEWED_COMMUNITY_FILES
} from '../scripts/community-phase1-reviewed-candidate.mjs';

const MAIN = 'a'.repeat(40);
const FEATURE = 'b'.repeat(40);
const request = {
  scope: 'community-phase1-hosted-write-preflight-only',
  mainSha: MAIN,
  featureSha: FEATURE,
  target: 'new-data-less-isolated-branch',
  confirmation: 'PREFLIGHT ONLY'
};

function inputs() {
  return {
    event: {
      repository: { full_name: 'bingohooah888-ai/novelrise' },
      issue: {
        number: 188,
        state: 'open',
        title: '[Staging Approval Control] Preview / Staging cost gate',
        user: { login: 'bingohooah888-ai' }
      },
      comment: {
        id: 123,
        user: { login: 'bingohooah888-ai' },
        author_association: 'OWNER',
        body: COMMUNITY_HOSTED_PREFLIGHT_MARKER + JSON.stringify(request)
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
    currentBranchRefs: []
  };
}

function rejects(mutate) {
  const input = inputs();
  mutate(input);
  assert.throws(
    () => verifyCommunityHostedPreprovision(input),
    /PREFLIGHT_DENIED/u
  );
}

test('valid immutable preflight cannot provision or mutate anything', () => {
  const result = verifyCommunityHostedPreprovision(inputs());
  assert.equal(result.status, 'READ_ONLY_PREFLIGHT_ONLY');
  assert.equal(result.mayCreateBranch, false);
  assert.equal(result.mayDeployPreview, false);
  assert.equal(result.mayRunBrowser, false);
  assert.equal(result.mayModifyProduction, false);
  assert.equal(result.requiresSeparateStagingApproval, true);
  assert.ok(Object.isFrozen(result));
});

test('owner and exact issue identity are mandatory', () => {
  rejects((x) => {
    x.event.comment.author_association = 'MEMBER';
  });
  rejects((x) => {
    x.event.comment.user.login = 'unknown';
  });
  rejects((x) => {
    x.event.issue.number = 294;
  });
  rejects((x) => {
    x.event.issue.state = 'closed';
  });
  rejects((x) => {
    x.event.issue.pull_request = {};
  });
});

test('stale main, altered head or active feature refuse preflight', () => {
  rejects((x) => {
    x.main.object.sha = 'f'.repeat(40);
  });
  rejects((x) => {
    x.feature.head.sha = 'f'.repeat(40);
  });
  rejects((x) => {
    x.feature.draft = false;
  });
  rejects((x) => {
    x.feature.merged = true;
  });
});

test('wrong intent or injected JSON keys refuse preflight', () => {
  rejects((x) => {
    x.event.comment.body =
      COMMUNITY_HOSTED_PREFLIGHT_MARKER +
      JSON.stringify({ ...request, confirmation: 'STAGING APPROVED' });
  });
  rejects((x) => {
    x.event.comment.body =
      COMMUNITY_HOSTED_PREFLIGHT_MARKER +
      JSON.stringify({ ...request, unexpected: true });
  });
  rejects((x) => {
    x.event.comment.body =
      COMMUNITY_HOSTED_PREFLIGHT_MARKER +
      JSON.stringify({
        ...request,
        scope: 'community-phase1-hosted-authenticated-write'
      });
  });
});

test('future workflow cannot have side-effectful permissions or operations', () => {
  const yaml = readFileSync(
    new URL(
      '../.github/workflows/community-hosted-preflight.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(
    yaml,
    /permissions:\n  contents: read\n  issues: read\n  pull-requests: read/u
  );
  assert.match(yaml, /ref: main/u);
  assert.match(yaml, /persist-credentials: false/u);
  assert.match(yaml, /github.event.issue.number == 188/u);
  assert.doesNotMatch(yaml, /\$\{\{ secrets\./u);
  assert.doesNotMatch(yaml, /\b(POST|DELETE|PATCH)\b/u);
  assert.doesNotMatch(yaml, /workflow_dispatch/u);
  assert.doesNotMatch(yaml, /gh api -X|curl --request|npx vercel/u);
});

test('reviewed file contents and current-main ancestry are required', () => {
  rejects((x) => {
    x.compare.files[0].sha = 'f'.repeat(40);
  });
  rejects((x) => {
    x.compare.files.pop();
  });
  rejects((x) => {
    x.compare.files.push({
      filename: 'unreviewed.js',
      sha: 'f'.repeat(40),
      status: 'added'
    });
  });
  rejects((x) => {
    x.compare.behind_by = 1;
  });
  rejects((x) => {
    x.compare.commits[0].sha = 'c'.repeat(40);
  });
  rejects((x) => {
    x.feature.base.sha = 'c'.repeat(40);
  });
});

test('new synced HEAD is allowed only with identical reviewed diff', () => {
  const x = inputs();
  const nextMain = 'c'.repeat(40);
  const nextHead = 'd'.repeat(40);
  const req = { ...request, mainSha: nextMain, featureSha: nextHead };
  x.event.comment.body =
    COMMUNITY_HOSTED_PREFLIGHT_MARKER + JSON.stringify(req);
  x.main.object.sha = nextMain;
  x.feature.base.sha = nextMain;
  x.feature.head.sha = nextHead;
  x.compare.base_commit.sha = nextMain;
  x.compare.commits[0].sha = nextHead;
  const decision = verifyCommunityHostedPreprovision(x);
  assert.equal(decision.featureSha, nextHead);
  assert.equal(decision.requiresSeparateStagingApproval, true);
  assert.equal(decision.mayCreateBranch, false);
});
