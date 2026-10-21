import assert from 'node:assert/strict';
import test from 'node:test';
import { makeHostedReviewEvidence } from './helpers/community-hosted-review-fixture.mjs';

import { makeCommunityHostedCoordinatorBindings } from '../scripts/community-hosted-coordinator-bindings.mjs';
import { verifyCommunityHostedPreCostAdmission } from '../scripts/community-hosted-precost-admission.mjs';
import { runCommunityHostedSingleLifecycle } from '../scripts/community-hosted-ordered-handoff.mjs';
import {
  HOSTED_CLAIMED,
  HOSTED_CONSUMED,
  HOSTED_SCOPE
} from '../scripts/community-hosted-write-admission.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const OWNER = 'bingohooah888-ai';
const MAIN = 'a'.repeat(40);
const FEATURE = '6bf0ea608183e4977fcdaa17d36b1712974d5a49';
const PROJECT = 'cccccccccccccccccccc';
const ORIGIN = 'https://isolated-community-preview.vercel.app';

function fixture({
  failBrowser = false,
  failClaim = false,
  watchdogCredentials,
  watchdogFetch
} = {}) {
  const calls = [];
  const event = {
    action: 'created',
    repository: { full_name: REPO },
    issue: {
      number: 188,
      title: '[Staging Approval Control] Preview / Staging cost gate',
      user: { login: OWNER }
    },
    comment: {
      id: 123,
      user: { login: OWNER },
      author_association: 'OWNER',
      body:
        'NOVELIGHT_STAGING_COMMUNITY_HOSTED_PRE_COST_APPROVE ' +
        JSON.stringify({
          confirmation: 'STAGING COST APPROVED',
          featureSha: FEATURE,
          mainSha: MAIN,
          scope: HOSTED_SCOPE,
          target: 'new-data-less-isolated-branch'
        })
    }
  };
  const main = { object: { sha: MAIN } };
  const feature = {
    number: 2222,
    state: 'open',
    draft: true,
    merged: false,
    base: { ref: 'main' },
    head: { sha: FEATURE, repo: { full_name: REPO } }
  };
  const reviewed = makeHostedReviewEvidence(event, feature, MAIN, FEATURE);
  const rows = [event.comment];
  const refs = new Map();
  const run = {
    repository: REPO,
    scope: HOSTED_SCOPE,
    mainSha: MAIN,
    candidateSha: FEATURE,
    requestCommentId: '123',
    runId: '456'
  };
  const preparation = verifyCommunityHostedPreCostAdmission({
    ...reviewed,
    event,
    main,
    feature,
    ledgerPages: [[...rows]],
    runId: run.runId
  });
  const ref = 'refs/tags/novelight-community-hosted-once-v1-123';
  const githubActions = {
    loadLiveSnapshot: async () => {
      calls.push('snapshot');
      return { main, feature, ...reviewed, ledgerPages: [[...rows]] };
    },
    loadProtectionEvidence: async () => {
      calls.push('protection');
      return {
        inventoryPages: [
          [
            {
              id: 412,
              target: 'tag',
              enforcement: 'active',
              source_type: 'Repository'
            }
          ]
        ],
        tagRuleDetails: [
          {
            id: 412,
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
          }
        ]
      };
    },
    createUniqueRef: async ({ ref: path, sha }) => {
      calls.push('reserve');
      if (refs.has(path)) return { status: 422 };
      refs.set(path, sha);
      return { status: 201, ref: path, sha };
    },
    readRef: async ({ ref: path }) => {
      calls.push('readRef');
      const sha = refs.get(path);
      return sha ? { status: 200, ref: path, sha } : { status: 404 };
    },
    postIssueComment: async ({ issueNumber, body }) => {
      calls.push('post');
      assert.equal(issueNumber, 188);
      if (failClaim && body.startsWith(HOSTED_CLAIMED)) {
        throw Error('SECRET_CLAIM_TIMEOUT');
      }
      const entry = {
        id: 124 + rows.length - 1,
        user: { login: 'github-actions[bot]' },
        body
      };
      rows.push(entry);
      return entry;
    }
  };
  const target = {
    mainSha: MAIN,
    candidateSha: FEATURE,
    previewRevision: FEATURE,
    previewOrigin: ORIGIN,
    supabaseOrigin: 'https://' + PROJECT + '.supabase.co',
    isolatedProjectRef: PROJECT,
    userIds: {
      author: 'c0a00000-0000-4000-8000-000000000001',
      reader: 'c0a00000-0000-4000-8000-000000000002',
      admin: 'c0a00000-0000-4000-8000-000000000003'
    }
  };
  const empty = () => ({
    publicEnabled: false,
    comments: 0,
    reactions: 0,
    reports: 0,
    notifications: 0,
    hiddenPosts: 0,
    restrictions: 0,
    testUsers: 0
  });
  const isolatedActions = Object.fromEntries(
    [
      'openGate',
      'closeGate',
      'revokeSessions',
      'removeFixtureRows',
      'removeTestUsers',
      'destroyIsolatedBranch'
    ].map((name) => [
      name,
      async () => {
        calls.push(name);
      }
    ])
  );
  isolatedActions.getSnapshot = async () => {
    calls.push('getSnapshot');
    return empty();
  };
  isolatedActions.runBrowser = async () => {
    calls.push('runBrowser');
    if (failBrowser) throw Error('SECRET_BROWSER_FAILURE');
    return {
      status: 'COMMUNITY_HOSTED_BROWSER_ASSERTIONS_COMPLETE',
      mainSha: MAIN,
      candidateSha: FEATURE,
      requestCommentId: run.requestCommentId,
      runId: run.runId,
      projectRef: PROJECT,
      previewOrigin: ORIGIN,
      userIds: { ...target.userIds },
      productionMutationObserved: false,
      twoIndependentUserSessions: true,
      separateAdminSession: true,
      anonymousAccessDenied: true,
      crossUserBlockMuteVerified: true,
      ownerOptInRevokeVerified: true,
      likesCommentsReportsNotificationsVerified: true,
      adminModerationAuditVerified: true,
      r15R18PrivateUnpublishedRpcExcluded: true
    };
  };
  isolatedActions.confirmBranchDeleted = async () => {
    calls.push('confirmBranchDeleted');
    return true;
  };
  const bindings = makeCommunityHostedCoordinatorBindings({
    repository: REPO,
    trustedMainSha: MAIN,
    event,
    preparation,
    githubActions,
    isolatedTarget: target,
    isolatedActions,
    watchdogCredentials,
    watchdogFetch
  });
  const operations = {
    verifyFreshProtectedBoundary: async () => {
      calls.push('verifyBoundary');
      return {
        ...run,
        status: 'FRESH_OWNER_PROTECTED_ENVIRONMENT_AND_BUDGET',
        ownerVerified: true,
        trustedMainVerified: true,
        tagProtectionVerified: true,
        exclusiveRunVerified: true,
        environmentProtectionVerified: true,
        oneUseStagingCostApproved: true,
        budgetBounded: true,
        cleanupPathVerified: true
      };
    },
    ...bindings,
    registerAndVerifyCleanupWatch: async () => {
      calls.push('watch');
      return {
        ...run,
        status: 'CLEANUP_WATCH_REGISTERED_NO_PROVISION',
        claimCommentId: '124',
        registrationCommentId: '126',
        signatureReadBackVerified: true,
        providerBranchAbsentAtRegistration: true,
        independentWatchdogReadyVerified: true,
        runAuthorized: false,
        mayCreateBranch: false
      };
    },
    obtainIndependentExecutionGrant: async () => {
      calls.push('grant');
      return {
        ...run,
        status: 'AUTHORIZED_BY_TRUSTED_MAIN_WORKFLOW',
        stagingCostApproved: true,
        runAuthorized: true,
        writeAuthorized: true,
        productionMutationApproved: false,
        protectedEnvironmentVerified: true,
        exclusiveRunVerified: true,
        projectRef: PROJECT,
        previewOrigin: ORIGIN
      };
    }
  };
  return { run, operations, bindings, calls, rows, refs, ref };
}

test('existing coordinator, isolated lifecycle and terminal receipt interoperate', async () => {
  const x = fixture();
  const result = await runCommunityHostedSingleLifecycle({
    run: x.run,
    operations: x.operations
  });
  assert.equal(result.status, 'HOSTED_LIFECYCLE_ORDERED_AND_TERMINAL_RECORDED');
  assert.equal(x.refs.get(x.ref), MAIN);
  assert.equal(x.rows.length, 3);
  assert.ok(x.rows[1].body.startsWith(HOSTED_CLAIMED));
  assert.ok(x.rows[2].body.startsWith(HOSTED_CONSUMED));
  assert.ok(x.rows[2].body.includes('"result":"success"'));
  assert.equal(x.calls.filter((c) => c === 'reserve').length, 1);
  assert.equal(x.calls.filter((c) => c === 'post').length, 2);
  assert.ok(
    x.calls.indexOf('runBrowser') < x.calls.indexOf('destroyIsolatedBranch')
  );
  assert.ok(
    x.calls.indexOf('confirmBranchDeleted') < x.calls.lastIndexOf('post')
  );
  assert.equal(result.runAuthorized, false);
});

test('a browser error runs cleanup and records exactly one failure terminal', async () => {
  const x = fixture({ failBrowser: true });
  await assert.rejects(
    runCommunityHostedSingleLifecycle({ run: x.run, operations: x.operations }),
    /terminal failure recorded/u
  );
  assert.ok(x.calls.includes('destroyIsolatedBranch'));
  assert.ok(x.calls.includes('confirmBranchDeleted'));
  assert.equal(x.calls.filter((c) => c === 'post').length, 2);
  assert.ok(x.rows[2].body.includes('"result":"failure"'));
  assert.equal(x.rows.length, 3);
});

test('ambiguous CLAIM never creates an isolated resource or CONSUME', async () => {
  const x = fixture({ failClaim: true });
  await assert.rejects(
    runCommunityHostedSingleLifecycle({ run: x.run, operations: x.operations }),
    /claim outcome unknown/u
  );
  assert.equal(x.refs.size, 1);
  assert.equal(x.rows.length, 1);
  assert.equal(x.calls.filter((c) => c === 'reserve').length, 1);
  assert.equal(x.calls.filter((c) => c === 'post').length, 1);
  assert.ok(!x.calls.includes('grant'));
  assert.ok(!x.calls.includes('runBrowser'));
});

test('bindings cannot issue cost grants or run on their own', async () => {
  const x = fixture();
  assert.ok(Object.isFrozen(x.bindings));
  assert.equal(x.bindings.obtainIndependentExecutionGrant, undefined);
  assert.equal(x.bindings.verifyFreshProtectedBoundary, undefined);
  await assert.rejects(
    runCommunityHostedSingleLifecycle({
      run: x.run,
      operations: x.bindings
    }),
    /DENIED/u
  );
  assert.deepEqual(x.calls, []);
});

test('candidate and request identity drift is denied before GitHub mutations', async () => {
  const x = fixture();
  await assert.rejects(
    x.bindings.reserveAndRecordClaim({
      ...x.run,
      requestCommentId: '999'
    }),
    /DENIED/u
  );
  assert.deepEqual(x.calls, []);
});

test('missing watchdog secrets deny without calling any external adapter', async () => {
  const x = fixture();
  await assert.rejects(
    x.bindings.registerAndVerifyCleanupWatch(x.run, {}, {}),
    /COMMUNITY_HOSTED_BINDINGS_DENIED/u
  );
  assert.deepEqual(x.calls, []);
});

test('watchdog connector uses authenticated GitHub reads, not fake flags', async () => {
  let requests = 0;
  const x = fixture({
    watchdogCredentials: {
      signingKey: 'synthetic-test-signing-key-at-least-32-characters',
      githubToken: 'synthetic-test-github-token-at-least-32-characters',
      supabaseToken: 'synthetic-test-supabase-token-at-least-32-chars'
    },
    watchdogFetch: async () => {
      requests += 1;
      return { status: 403 };
    }
  });
  const grant = await x.operations.obtainIndependentExecutionGrant();
  const claim = {
    ...x.run,
    status: 'RESERVATION_AND_CLAIM_RECORDED_NO_RUN_AUTHORIZATION',
    claimCommentId: '124'
  };
  await assert.rejects(
    x.bindings.registerAndVerifyCleanupWatch(x.run, grant, claim),
    /COMMUNITY_WATCHDOG_LIVE_DENIED/u
  );
  assert.equal(requests, 1);
  assert.ok(!x.calls.includes('runBrowser'));
});
