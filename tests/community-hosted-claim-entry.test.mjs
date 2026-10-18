import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  inspectCommunityHostedClaimEntry,
  recordCommunityHostedOwnerClaim
} from '../scripts/community-hosted-claim-entry.mjs';
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
const FEATURE = '6bf0ea608183e4977fcdaa17d36b1712974d5a49';
const ISSUE = 'https://api.github.com/repos/' + REPO + '/issues/188';

function harness() {
  const comment = {
    id: 123,
    issue_url: ISSUE,
    body:
      HOSTED_PRE_COST_APPROVE +
      JSON.stringify({
        confirmation: 'STAGING COST APPROVED',
        mainSha: MAIN,
        featureSha: FEATURE,
        scope: HOSTED_SCOPE,
        target: 'new-data-less-isolated-branch'
      }),
    created_at: '2026-10-18T02:00:00Z',
    updated_at: '2026-10-18T02:00:00Z',
    author_association: 'OWNER',
    user: { login: OWNER }
  };
  const issue = {
    id: 999,
    number: 188,
    title: '[Staging Approval Control] Preview / Staging cost gate',
    user: { login: OWNER },
    url: ISSUE
  };
  const event = {
    action: 'created',
    repository: { full_name: REPO },
    issue: { ...issue },
    comment: { ...comment }
  };
  const environment = {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'issue_comment',
    GITHUB_REPOSITORY: REPO,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW_REF:
      REPO + '/.github/workflows/community-hosted-claim-only.yml@refs/heads/main',
    GITHUB_ACTOR: OWNER,
    GITHUB_TRIGGERING_ACTOR: OWNER,
    GITHUB_RUN_ID: '456',
    GITHUB_SHA: MAIN
  };
  const ledger = [comment];
  const refs = new Map();
  const calls = [];
  const actions = {
    loadLiveSnapshot: async () => {
      calls.push('loadLiveSnapshot');
      return {
        main: { object: { sha: MAIN } },
        feature: {
          number: 2222,
          state: 'open',
          draft: true,
          merged: false,
          base: { ref: 'main' },
          head: { sha: FEATURE, repo: { full_name: REPO } }
        },
        ledgerPages: [[...ledger]]
      };
    },
    loadProtectionEvidence: async () => {
      calls.push('loadProtectionEvidence');
      return {
        inventoryPages: [[{
          id: 25337852,
          target: 'tag',
          enforcement: 'active',
          source_type: 'Repository'
        }]],
        tagRuleDetails: [{
          id: 25337852,
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
          rules: [{ type: 'update' }, { type: 'deletion' }]
        }]
      };
    },
    createUniqueRef: async ({ ref, sha }) => {
      calls.push('createUniqueRef');
      if (refs.has(ref)) return { status: 422 };
      refs.set(ref, sha);
      return { status: 201, ref, sha };
    },
    readRef: async ({ ref }) => {
      calls.push('readRef');
      return { status: 200, ref, sha: refs.get(ref) };
    },
    postIssueComment: async ({ issueNumber, body }) => {
      calls.push('postIssueComment');
      assert.equal(issueNumber, 188);
      const claim = {
        id: 124,
        body,
        user: { login: 'github-actions[bot]' }
      };
      ledger.push(claim);
      return claim;
    }
  };
  return { event, issue, comment, environment, checkedOutSha: MAIN, actions, ledger, refs, calls };
}

test('fresh OWNER workflow identity is recognized without granting any execution', () => {
  const x = harness();
  const result = inspectCommunityHostedClaimEntry(x);
  assert.equal(result.requestCommentId, '123');
  assert.equal(result.runId, '456');
  assert.equal(result.trustedMainSha, MAIN);
  for (const key of [
    'stagingCostApproved',
    'runAuthorized',
    'writeAuthorized',
    'releaseAuthorized'
  ]) {
    assert.equal(result[key], false);
  }
  assert.ok(Object.isFrozen(result));
});

test('one authentic claim creates exactly one immutable reservation and no grant', async () => {
  const x = harness();
  const output = await recordCommunityHostedOwnerClaim(x);
  assert.equal(output.status, 'COMMUNITY_HOSTED_OWNER_CLAIM_RECORDED_NO_EXECUTION');
  assert.equal(output.runAuthorized, false);
  assert.equal(output.writeAuthorized, false);
  assert.equal(output.stagingCostApproved, false);
  assert.equal(x.refs.size, 1);
  assert.equal(x.ledger.length, 2);
  assert.ok(x.ledger[1].body.startsWith(HOSTED_CLAIMED));
  assert.deepEqual(x.calls, [
    'loadLiveSnapshot',
    'loadProtectionEvidence',
    'createUniqueRef',
    'readRef',
    'loadLiveSnapshot',
    'loadProtectionEvidence',
    'postIssueComment',
    'loadLiveSnapshot'
  ]);
  await assert.rejects(recordCommunityHostedOwnerClaim(x), /DENIED/u);
  assert.equal(x.refs.size, 1);
  assert.equal(x.ledger.length, 2);
});

test('spoofed, stale, edited or rerun owner event is rejected before writes', async () => {
  const cases = [
    (x) => { x.environment.GITHUB_ACTOR = 'random-contributor'; },
    (x) => { x.environment.GITHUB_TRIGGERING_ACTOR = 'random-contributor'; },
    (x) => { x.environment.GITHUB_SHA = 'b'.repeat(40); },
    (x) => { x.environment.GITHUB_WORKFLOW_REF = 'other.yml'; },
    (x) => { x.environment.GITHUB_RUN_ID = '1; echo hi'; },
    (x) => { x.environment.GITHUB_REF = 'refs/heads/staging'; },
    (x) => { x.event.action = 'edited'; },
    (x) => { x.event.issue.id = 1001; },
    (x) => { x.issue.user.login = 'somebody'; },
    (x) => { x.issue.pull_request = { url: 'pull' }; },
    (x) => { x.comment.issue_url = 'https://api.github.com/repos/other/issues/188'; },
    (x) => { x.comment.updated_at = '2026-10-18T02:01:00Z'; },
    (x) => { x.comment.body += 'changed'; },
    (x) => { x.event.comment.user.login = 'somebody'; },
    (x) => { x.event.comment.author_association = 'CONTRIBUTOR'; },
    (x) => { x.checkedOutSha = 'b'.repeat(40); }
  ];
  for (const mutate of cases) {
    const x = harness();
    mutate(x);
    await assert.rejects(recordCommunityHostedOwnerClaim(x), /CLAIM_ENTRY_DENIED/u);
    assert.deepEqual(x.calls, []);
    assert.equal(x.refs.size, 0);
  }
});

test('reservation ruleset denial is never a cost or execution permission', async () => {
  const x = harness();
  x.actions.loadProtectionEvidence = async () => {
    x.calls.push('loadProtectionEvidence');
    return { inventoryPages: [[]], tagRuleDetails: [] };
  };
  await assert.rejects(recordCommunityHostedOwnerClaim(x), /DENIED/u);
  assert.equal(x.refs.size, 0);
  assert.equal(x.ledger.length, 1);
});

test('the only workflow entry is an OWNER-bound, tag-only audit with no staging', () => {
  const text = readFileSync(
    new URL('../.github/workflows/community-hosted-claim-only.yml', import.meta.url),
    'utf8'
  );
  for (const necessary of [
    'issue_comment:',
    'types: [created]',
    'cancel-in-progress: false',
    'github.triggering_actor',
    'persist-credentials: false',
    'community-hosted-claim-entry.mjs claim',
    'GITHUB_EVENT_PATH',
    'contents: write',
    'issues: write',
    'Staging cost'
  ]) {
    assert.ok(text.includes(necessary), necessary);
  }
  for (const forbidden of [
    'workflow_dispatch',
    'environment: staging',
    'secrets.',
    'VERCEL_API_TOKEN',
    'SUPABASE_ACCESS_TOKEN',
    'npx vercel',
    'supabase db',
    'gh api -X POST',
    'deployment_status:'
  ]) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
});
