import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSTED_PRE_COST_APPROVE,
  verifyCommunityHostedPreCostAdmission
} from '../scripts/community-hosted-precost-admission.mjs';
import {
  HOSTED_CLAIMED,
  HOSTED_CONSUMED,
  HOSTED_SCOPE
} from '../scripts/community-hosted-write-admission.mjs';
import {
  recordCommunityHostedConsumption,
  reserveAndRecordCommunityHostedClaim
} from '../scripts/community-hosted-reservation-coordinator.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const OWNER = 'bingohooah888-ai';
const MAIN = 'a'.repeat(40);
const FEATURE = '6bf0ea608183e4977fcdaa17d36b1712974d5a49';
const RUN = '456';

function harness(options = {}) {
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
        HOSTED_PRE_COST_APPROVE +
        JSON.stringify({
          confirmation: 'STAGING COST APPROVED',
          featureSha: FEATURE,
          mainSha: MAIN,
          scope: HOSTED_SCOPE,
          target: 'new-data-less-isolated-branch'
        })
    }
  };
  const comments = [event.comment];
  const references = new Map();
  const calls = [];
  let mainSha = MAIN;
  let candidateSha = FEATURE;
  let nextCommentId = 124;
  let protectionReadCount = 0;
  let refReadCount = 0;
  const actions = {
    loadProtectionEvidence: async () => {
      calls.push('loadProtectionEvidence');
      protectionReadCount += 1;
      if (options.protectionThrows) {
        throw new Error('SECRET_MUST_NOT_LEAK');
      }
      if (
        options.protectionMissing ||
        (options.protectionRemovedAfterReservation &&
          protectionReadCount > 1) ||
        (options.protectionRemovedDuringConsume && protectionReadCount >= 3) ||
        (options.protectionRemovedBeforeConsumePost && protectionReadCount >= 4)
      ) {
        return {
          inventoryPages: [
            [
              {
                id: 21196358,
                target: 'branch',
                enforcement: 'active',
                source_type: 'Repository'
              }
            ]
          ],
          tagRuleDetails: []
        };
      }
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
            bypass_actors: options.bypassPresent
              ? [{ actor_type: 'RepositoryRole', actor_id: 5 }]
              : [],
            conditions: {
              ref_name: {
                include: ['refs/tags/novelight-community-hosted-once-v1-*'],
                exclude: []
              }
            },
            rules: [{ type: 'deletion' }, { type: 'update' }]
          }
        ]
      };
    },
    loadLiveSnapshot: async () => {
      calls.push('loadLiveSnapshot');
      if (options.loadThrows) throw new Error('SECRET_MUST_NOT_LEAK');
      return {
        main: { object: { sha: mainSha } },
        feature: {
          number: 2222,
          state: 'open',
          draft: true,
          merged: false,
          base: { ref: 'main' },
          head: { sha: candidateSha, repo: { full_name: REPO } }
        },
        ledgerPages: [[...comments]]
      };
    },
    createUniqueRef: async ({ ref, sha }) => {
      calls.push('createUniqueRef');
      if (references.has(ref)) return { status: 422 };
      references.set(ref, sha);
      if (options.createThrows) throw new Error('SECRET_MUST_NOT_LEAK');
      if (options.changeMainAfterReservation) mainSha = 'b'.repeat(40);
      if (options.addClaimAfterReservation) {
        comments.push({
          id: nextCommentId++,
          user: { login: 'github-actions[bot]' },
          body:
            HOSTED_CLAIMED +
            JSON.stringify({
              requestCommentId: '123',
              mainSha: MAIN,
              featureSha: FEATURE,
              runId: '777'
            })
        });
      }
      return {
        status: options.createStatus ?? 201,
        ref,
        sha
      };
    },
    readRef: async ({ ref }) => {
      calls.push('readRef');
      refReadCount += 1;
      if (options.readThrows) throw new Error('SECRET_MUST_NOT_LEAK');
      const sha = references.get(ref);
      return sha
        ? {
            status: 200,
            ref,
            sha:
              options.tamperRef ||
              (options.tamperBeforeConsumePost && refReadCount >= 3)
                ? 'b'.repeat(40)
                : sha
          }
        : { status: 404 };
    },
    postIssueComment: async ({ issueNumber, body }) => {
      calls.push('postIssueComment');
      assert.equal(issueNumber, 188);
      if (options.postThrows) throw new Error('SECRET_MUST_NOT_LEAK');
      const row = {
        id: nextCommentId++,
        body: options.tamperPostBody ? 'tampered' : body,
        user: {
          login: options.tamperPostActor
            ? 'untrusted[bot]'
            : 'github-actions[bot]'
        }
      };
      if (!options.omitPersistedPost) comments.push(row);
      if (options.moveMainAfterPost) mainSha = 'b'.repeat(40);
      if (comments.length === 3 && options.moveMainAfterConsumePost) {
        mainSha = 'b'.repeat(40);
      }
      if (comments.length === 3 && options.moveFeatureAfterConsumePost) {
        candidateSha = 'b'.repeat(40);
      }
      return row;
    }
  };
  const args = () => ({
    repository: REPO,
    trustedMainSha: MAIN,
    event,
    runId: RUN,
    actions
  });
  const preparation = () => {
    const snapshot = {
      main: { object: { sha: MAIN } },
      feature: {
        number: 2222,
        state: 'open',
        draft: true,
        merged: false,
        base: { ref: 'main' },
        head: { sha: FEATURE, repo: { full_name: REPO } }
      },
      ledgerPages: [[event.comment]]
    };
    return verifyCommunityHostedPreCostAdmission({
      event,
      main: snapshot.main,
      feature: snapshot.feature,
      ledgerPages: snapshot.ledgerPages,
      runId: RUN
    });
  };
  const reserve = () => reserveAndRecordCommunityHostedClaim(args());
  const consume = (outcome = 'failure', lifecycleProof) =>
    recordCommunityHostedConsumption({
      repository: REPO,
      trustedMainSha: MAIN,
      event,
      preparation: preparation(),
      outcome,
      lifecycleProof,
      actions
    });
  return {
    actions,
    args,
    calls,
    comments,
    references,
    reserve,
    consume,
    event,
    preparation,
    setMain: (next) => {
      mainSha = next;
    },
    setCandidate: (next) => {
      candidateSha = next;
    }
  };
}

function runProof() {
  return {
    status: 'BROWSER_VERIFIED_AND_BRANCH_DISPOSED',
    browserVerified: true,
    cleanupVerified: true,
    mainSha: MAIN,
    candidateSha: FEATURE,
    requestCommentId: '123',
    runId: RUN
  };
}

function assertDisabled(result) {
  for (const field of [
    'stagingCostApproved',
    'runAuthorized',
    'writeAuthorized',
    'releaseAuthorized',
    'mayDeployPreview',
    'mayCreateBranch',
    'mayRunBrowser'
  ]) {
    assert.equal(result[field], false, field);
  }
  assert.equal(result.executableGrantIssued, false);
  assert.ok(Object.isFrozen(result));
}

test('single Git ref reservation records exactly one matching claim without authorization', async () => {
  const x = harness();
  const receipt = await x.reserve();
  assert.equal(
    receipt.status,
    'RESERVATION_AND_CLAIM_RECORDED_NO_RUN_AUTHORIZATION'
  );
  assert.equal(
    receipt.reservationRef,
    'refs/tags/novelight-community-hosted-once-v1-123'
  );
  assert.equal(receipt.claimCommentId, '124');
  assert.equal(x.references.size, 1);
  assert.equal(x.comments.length, 2);
  assert.ok(x.comments[1].body.startsWith(HOSTED_CLAIMED));
  assertDisabled(receipt);
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
});

test('two concurrent attempts sharing one approval can reserve only once', async () => {
  const x = harness();
  const results = await Promise.allSettled([x.reserve(), x.reserve()]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(results.filter((row) => row.status === 'rejected').length, 1);
  assert.equal(x.references.size, 1);
  assert.equal(
    x.comments.filter((row) => row.body.startsWith(HOSTED_CLAIMED)).length,
    1
  );
});

test('later replay never creates another reservation or claim', async () => {
  const x = harness();
  await x.reserve();
  await assert.rejects(x.reserve(), /DENIED/u);
  assert.equal(x.calls.filter((name) => name === 'createUniqueRef').length, 1);
  assert.equal(x.comments.length, 2);
});

test('unknown ref-creation result leaves permanent reservation but no retry', async () => {
  const x = harness({ createThrows: true });
  await assert.rejects(x.reserve(), (error) => {
    assert.match(error.message, /DENIED/u);
    assert.doesNotMatch(error.message, /SECRET_MUST_NOT_LEAK/u);
    return true;
  });
  assert.equal(x.references.size, 1);
  assert.ok(!x.calls.includes('postIssueComment'));
  await assert.rejects(x.reserve(), /DENIED/u);
  assert.equal(x.calls.filter((name) => name === 'createUniqueRef').length, 2);
  assert.equal(x.comments.length, 1);
});

test('incorrect reservation response and altered ref fail closed', async () => {
  for (const options of [{ createStatus: 422 }, { tamperRef: true }]) {
    const x = harness(options);
    await assert.rejects(x.reserve(), /DENIED/u);
    assert.ok(!x.calls.includes('postIssueComment'));
    assert.equal(x.references.size, 1);
  }
});

test('main drift or competing claim after ref reservation never reaches POST', async () => {
  for (const options of [
    { changeMainAfterReservation: true },
    { addClaimAfterReservation: true }
  ]) {
    const x = harness(options);
    await assert.rejects(x.reserve(), /DENIED/u);
    assert.ok(!x.calls.includes('postIssueComment'));
    assert.equal(x.references.size, 1);
  }
});

test('missing owner evidence or trusted main identity fails before external mutation', async () => {
  const x = harness();
  x.setMain('b'.repeat(40));
  await assert.rejects(x.reserve(), /DENIED/u);
  assert.ok(!x.calls.includes('createUniqueRef'));
  const y = harness();
  const args = y.args();
  args.trustedMainSha = 'invalid';
  await assert.rejects(reserveAndRecordCommunityHostedClaim(args), /DENIED/u);
  assert.deepEqual(y.calls, []);
  const z = harness();
  z.comments.splice(0);
  await assert.rejects(z.reserve(), /DENIED/u);
  assert.ok(!z.calls.includes('createUniqueRef'));
});

test('post failure after reservation blocks replay and redacts secrets', async () => {
  const x = harness({ postThrows: true });
  await assert.rejects(x.reserve(), (error) => {
    assert.match(error.message, /DENIED/u);
    assert.doesNotMatch(error.message, /SECRET_MUST_NOT_LEAK/u);
    return true;
  });
  assert.equal(x.references.size, 1);
  assert.equal(x.comments.length, 1);
  await assert.rejects(x.reserve(), /DENIED/u);
  assert.equal(x.comments.length, 1);
});

test('forged or unpersisted claim receipt never passes', async () => {
  for (const options of [
    { tamperPostBody: true },
    { tamperPostActor: true },
    { omitPersistedPost: true },
    { moveMainAfterPost: true }
  ]) {
    const x = harness(options);
    await assert.rejects(x.reserve(), /DENIED/u);
    assert.equal(x.references.size, 1);
  }
});

test('terminal failure and cancellation require exact persisted claim', async () => {
  for (const outcome of ['failure', 'cancelled']) {
    const x = harness();
    await x.reserve();
    const final = await x.consume(outcome);
    assert.equal(final.status, 'CONSUMPTION_RECORDED_NO_RUN_AUTHORIZATION');
    assert.equal(final.consumeCommentId, '125');
    assert.equal(final.outcome, outcome);
    assert.ok(x.comments[2].body.startsWith(HOSTED_CONSUMED));
    assertDisabled(final);
  }
});

test('successful terminal record must have run-bound, complete lifecycle evidence', async () => {
  const x = harness();
  await x.reserve();
  for (const proof of [
    undefined,
    { ...runProof(), runId: '999' },
    { ...runProof(), cleanupVerified: false },
    { ...runProof(), browserVerified: false }
  ]) {
    await assert.rejects(x.consume('success', proof), /DENIED/u);
  }
  assert.equal(x.comments.length, 2);
  const receipt = await x.consume('success', runProof());
  assert.equal(receipt.outcome, 'success');
  assertDisabled(receipt);
});

test('consumption refuses duplicate, orphan, stale or spoofed records', async () => {
  const a = harness();
  await assert.rejects(a.consume(), /DENIED/u);
  const b = harness();
  await b.reserve();
  await b.consume();
  await assert.rejects(b.consume(), /DENIED/u);
  assert.equal(b.comments.length, 3);
  const c = harness();
  await c.reserve();
  c.setMain('b'.repeat(40));
  await assert.rejects(c.consume(), /DENIED/u);
  assert.equal(c.comments.length, 2);
  const d = harness();
  await d.reserve();
  d.setCandidate('b'.repeat(40));
  await assert.rejects(d.consume(), /DENIED/u);
  assert.equal(d.comments.length, 2);
});

test('ambiguous terminal POST or missing ledger echo must not be silently accepted', async () => {
  for (const options of [{ postThrows: true }, { omitPersistedPost: true }]) {
    const x = harness(options);
    if (options.postThrows || options.omitPersistedPost) {
      // Seed one already confirmed claim, avoiding the deliberately failing POST
      // adapter during the initial reservation phase.
      const reservationRef = 'refs/tags/novelight-community-hosted-once-v1-123';
      x.references.set(reservationRef, MAIN);
      x.comments.push({
        id: 124,
        user: { login: 'github-actions[bot]' },
        body:
          HOSTED_CLAIMED +
          JSON.stringify({
            requestCommentId: '123',
            mainSha: MAIN,
            featureSha: FEATURE,
            runId: RUN
          })
      });
    }
    await assert.rejects(x.consume(), /DENIED/u);
    assert.equal(x.references.size, 1);
  }
});

test('missing GitHub write adapters fail before any API invocation', async () => {
  const x = harness();
  const args = x.args();
  delete args.actions.createUniqueRef;
  await assert.rejects(reserveAndRecordCommunityHostedClaim(args), /DENIED/u);
  assert.deepEqual(x.calls, []);
});

test('real main-only branch protection cannot authorize a reservation', async () => {
  const x = harness({ protectionMissing: true });
  await assert.rejects(x.reserve(), /COMMUNITY_HOSTED_REF_PROTECTION_DENIED/u);
  assert.deepEqual(x.calls, ['loadLiveSnapshot', 'loadProtectionEvidence']);
  assert.equal(x.references.size, 0);
  assert.equal(x.comments.length, 1);
});

test('tag ruleset bypass and unreadable evidence deny before any write', async () => {
  for (const options of [{ bypassPresent: true }, { protectionThrows: true }]) {
    const x = harness(options);
    await assert.rejects(x.reserve(), (error) => {
      assert.match(error.message, /DENIED/u);
      assert.doesNotMatch(error.message, /SECRET_MUST_NOT_LEAK/u);
      return true;
    });
    assert.equal(x.references.size, 0);
    assert.equal(x.comments.length, 1);
  }
});

test('protection removed after reservation prevents claim comment POST', async () => {
  const x = harness({ protectionRemovedAfterReservation: true });
  await assert.rejects(x.reserve(), /DENIED/u);
  assert.equal(x.references.size, 1);
  assert.ok(!x.calls.includes('postIssueComment'));
  assert.equal(x.comments.length, 1);
  assert.equal(
    x.calls.filter((name) => name === 'loadProtectionEvidence').length,
    2
  );
});

test('missing protection evidence adapter is rejected before any API call', async () => {
  const x = harness();
  const args = x.args();
  delete args.actions.loadProtectionEvidence;
  await assert.rejects(reserveAndRecordCommunityHostedClaim(args), /DENIED/u);
  assert.deepEqual(x.calls, []);
});

test('terminal CONSUME refuses unprotected tags, even for a valid recorded claim', async () => {
  const x = harness({ protectionRemovedDuringConsume: true });
  await x.reserve();
  const existing = x.comments.length;
  await assert.rejects(x.consume('failure'), /DENIED/u);
  assert.equal(x.comments.length, existing);
  assert.equal(x.references.size, 1);
  assert.ok(!x.calls.slice(-2).includes('postIssueComment'));
});

test('terminal CONSUME aborts when tag protection disappears before posting', async () => {
  const x = harness({ protectionRemovedBeforeConsumePost: true });
  await x.reserve();
  const existing = x.comments.length;
  await assert.rejects(x.consume('cancelled'), /DENIED/u);
  assert.equal(x.comments.length, existing);
  assert.equal(x.references.size, 1);
  assert.equal(
    x.calls.filter((name) => name === 'loadProtectionEvidence').length,
    4
  );
});

test('CONSUME refuses mutation of reserved ref just before terminal POST', async () => {
  const x = harness({ tamperBeforeConsumePost: true });
  await x.reserve();
  await assert.rejects(x.consume('failure'), /DENIED/u);
  assert.equal(x.comments.length, 2);
  assert.equal(x.references.size, 1);
});

test('CONSUME rejects main or candidate revision movement after a terminal write', async () => {
  for (const options of [
    { moveMainAfterConsumePost: true },
    { moveFeatureAfterConsumePost: true }
  ]) {
    const x = harness(options);
    await x.reserve();
    await assert.rejects(x.consume('failure'), /DENIED/u);
    assert.equal(x.comments.length, 3);
    assert.equal(x.references.size, 1);
  }
});

test('CONSUME requires protection adapter even for already-claimed requests', async () => {
  const x = harness();
  await x.reserve();
  delete x.actions.loadProtectionEvidence;
  await assert.rejects(x.consume('failure'), /DENIED/u);
  assert.equal(x.comments.length, 2);
});
