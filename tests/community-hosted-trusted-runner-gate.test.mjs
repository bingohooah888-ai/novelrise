import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import {
  HOSTED_CLAIMED,
  HOSTED_SCOPE
} from '../scripts/community-hosted-write-admission.mjs';
import {
  HOSTED_PRE_COST_APPROVE
} from '../scripts/community-hosted-precost-admission.mjs';
import {
  inspectCommunityHostedTrustedRunner
} from '../scripts/community-hosted-trusted-runner-gate.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const OWNER = 'bingohooah888-ai';
const MAIN = 'a'.repeat(40);
const FEATURE = '6bf0ea608183e4977fcdaa17d36b1712974d5a49';
const WORKFLOW =
  REPO +
  '/.github/workflows/community-hosted-precost-inspection.yml@refs/heads/main';

function fixture() {
  const comment = {
    id: 123,
    user: { login: OWNER },
    author_association: 'OWNER',
    body:
      HOSTED_PRE_COST_APPROVE +
      JSON.stringify({
        confirmation: 'STAGING COST APPROVED',
        scope: HOSTED_SCOPE,
        mainSha: MAIN,
        featureSha: FEATURE,
        target: 'new-data-less-isolated-branch'
      })
  };
  return {
    context: {
      repository: REPO,
      workflowRef: WORKFLOW,
      eventName: 'issue_comment',
      ref: 'refs/heads/main',
      eventSha: MAIN,
      checkoutSha: MAIN,
      actor: OWNER,
      triggeringActor: OWNER,
      runAttempt: '1',
      runId: '456'
    },
    event: {
      action: 'created',
      repository: { full_name: REPO },
      sender: { login: OWNER },
      issue: {
        number: 188,
        title: '[Staging Approval Control] Preview / Staging cost gate',
        user: { login: OWNER }
      },
      comment
    },
    main: { object: { sha: MAIN } },
    feature: {
      number: 2222,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main' },
      head: { sha: FEATURE, repo: { full_name: REPO } }
    },
    ledgerPages: [[comment]],
    inventoryPages: [[{
      id: 900,
      target: 'tag',
      enforcement: 'active',
      source_type: 'Repository'
    }]],
    tagRuleDetails: [{
      id: 900,
      target: 'tag',
      enforcement: 'active',
      source_type: 'Repository',
      source: REPO,
      current_user_can_bypass: 'never',
      bypass_actors: [],
      conditions: {
        ref_name: {
          include: ['refs/tags/novelight-community-hosted-once-v1-*'],
          exclude: []
        }
      },
      rules: [{ type: 'deletion' }, { type: 'update' }]
    }]
  };
}

function reject(mutator) {
  const x = fixture();
  mutator(x);
  assert.throws(
    () => inspectCommunityHostedTrustedRunner(x),
    /DENIED/u
  );
}

test('valid synthetic OWNER context produces only a frozen non-grant', () => {
  const x = inspectCommunityHostedTrustedRunner(fixture());
  assert.equal(x.status, 'COMMUNITY_HOSTED_TRUSTED_MAIN_READ_ONLY_PRECHECK');
  assert.equal(x.mainSha, MAIN);
  assert.equal(x.candidateSha, FEATURE);
  assert.equal(x.requestCommentId, '123');
  assert.equal(x.runId, '456');
  assert.deepEqual(x.reservationRulesetIds, [900]);
  assert.ok(Object.isFrozen(x));
  assert.ok(Object.isFrozen(x.reservationRulesetIds));
  for (const key of [
    'authenticatedOwnerByThisModule',
    'atomicClaimVerified',
    'stagingCostApproved',
    'mayClaim',
    'mayCreateBranch',
    'mayDeployPreview',
    'mayRunBrowser',
    'runAuthorized',
    'writeAuthorized',
    'releaseAuthorized'
  ]) {
    assert.equal(x[key], false, key);
  }
});

test('actual branch-only protection denies trusted runner preflight', () => {
  reject((x) => {
    x.inventoryPages = [[{
      id: 21196358,
      target: 'branch',
      source_type: 'Repository',
      enforcement: 'active'
    }]];
    x.tagRuleDetails = [];
  });
});

test('untrusted runner, checkout ref or event origin denies', () => {
  for (const [field, value] of [
    ['repository', 'attacker/repo'],
    ['workflowRef', REPO + '/.github/workflows/other.yml@refs/heads/main'],
    ['eventName', 'workflow_dispatch'],
    ['ref', 'refs/heads/feature'],
    ['eventSha', 'b'.repeat(40)],
    ['checkoutSha', 'b'.repeat(40)],
    ['actor', 'attacker'],
    ['triggeringActor', 'attacker'],
    ['runAttempt', '2'],
    ['runId', 'not-an-id']
  ]) {
    reject((x) => {
      x.context[field] = value;
    });
  }
});

test('untrusted sender or stale OWNER approval is denied', () => {
  reject((x) => {
    x.event.sender.login = 'attacker';
  });
  reject((x) => {
    x.event.comment.user.login = 'attacker';
  });
  reject((x) => {
    x.event.comment.author_association = 'NONE';
  });
  reject((x) => {
    x.event.action = 'edited';
  });
  reject((x) => {
    x.event.issue.number = 294;
  });
  reject((x) => {
    x.event.comment.body = 'arbitrary';
  });
});

test('wrong main revision or Draft candidate is denied', () => {
  reject((x) => {
    x.main.object.sha = 'b'.repeat(40);
  });
  reject((x) => {
    x.feature.head.sha = 'b'.repeat(40);
  });
  reject((x) => {
    x.feature.draft = false;
  });
  reject((x) => {
    x.feature.merged = true;
  });
});

test('replayed claim or incomplete comment ledger is denied', () => {
  reject((x) => {
    x.ledgerPages = [[]];
  });
  reject((x) => {
    x.ledgerPages.push([]);
  });
  reject((x) => {
    x.ledgerPages[0].push({
      id: 124,
      user: { login: 'github-actions[bot]' },
      body:
        HOSTED_CLAIMED +
        JSON.stringify({
          requestCommentId: '123',
          mainSha: MAIN,
          featureSha: FEATURE,
          runId: '456'
        })
    });
  });
});

test('missing nonbypassable active tag ruleset or partial scope denies', () => {
  reject((x) => {
    x.tagRuleDetails = [];
  });
  reject((x) => {
    x.tagRuleDetails[0].enforcement = 'evaluate';
  });
  reject((x) => {
    x.tagRuleDetails[0].bypass_actors = [{
      actor_type: 'RepositoryRole',
      actor_id: 5,
      bypass_mode: 'always'
    }];
  });
  reject((x) => {
    x.tagRuleDetails[0].rules = [{ type: 'deletion' }];
  });
  reject((x) => {
    x.tagRuleDetails[0].conditions.ref_name.include = [
      'refs/tags/other-*'
    ];
  });
});

test('pre-cost workflow remains owner-only, read-only, and fail-closed', () => {
  const path = new URL(
    '../.github/workflows/community-hosted-precost-inspection.yml',
    import.meta.url
  );
  const workflow = readFileSync(path, 'utf8');
  for (const required of [
    'issue_comment:',
    'types: [created]',
    'github.event.comment.author_association == \'OWNER\'',
    'ref: main',
    'persist-credentials: false',
    'community-hosted-reservation-protection.mjs validate',
    'community-hosted-trusted-runner-gate.mjs validate',
    'HOSTED_TRUSTED_CHECKOUT_SHA',
    '.mayClaim == false',
    '.runAuthorized == false',
    '.stagingCostApproved == false'
  ]) {
    assert.ok(workflow.includes(required), required);
  }
  for (const forbidden of [
    'contents: write',
    'issues: write',
    'gh api -X',
    'environment: staging',
    'workflow_dispatch:',
    'secrets.',
    'vercel deploy',
    'supabase db'
  ]) {
    assert.ok(!workflow.includes(forbidden), forbidden);
  }
});
