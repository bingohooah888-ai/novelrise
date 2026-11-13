import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFormalEarningRunner } from '../api/_lib/reader-reward/formal-earning-runner.js';
import { reviewFormalEpisodeComment } from '../api/_lib/reader-reward/formal-comment-eligibility.js';

const commentId = '00000000-0000-4000-8000-000000000101';
const readId = '00000000-0000-4000-8000-000000000102';
const userId = '00000000-0000-4000-8000-000000000103';
const token = '00000000-0000-4000-8000-000000000104';
const reviewerId = '00000000-0000-4000-8000-000000000105';
const reviewId = '00000000-0000-4000-8000-000000000106';
const release = '2027-01-01T00:00:00Z';
const launch = {
  formalEarningsEnabled: true,
  productionCutoverApproved: true,
  formalWorkerEnabled: true
};
const auth = { serviceRoleVerified: true, verifiedByTrustedServer: true };
const comment = {
  id: commentId,
  user_id: userId,
  episode_id: 9,
  body: '展開が面白かったです',
  created_at: '2027-02-02T00:00:00Z',
  deleted_at: null,
  author_hidden_at: null
};
const reviewedProof = (body = comment.body) => ({
  reviewerId,
  reviewId,
  bodySha256: createHash('sha256').update(body, 'utf8').digest('hex')
});
const create = (client, extra = {}) =>
  createFormalEarningRunner({
    postgresClient: client,
    releaseTimestampIso: release,
    launchConfiguration: launch,
    trustedServerAuthorization: auth,
    ...extra
  });

function sourceDb({ body = comment.body, history = [] } = {}) {
  const calls = [];
  const client = {
    query: async (sql, args) => {
      calls.push([sql, args]);
      if (sql.includes('from public.novel_comments where id='))
        return { rows: [{ ...comment, body }] };
      if (sql.includes('from public.novel_comments where user_id='))
        return { rows: history };
      if (sql.includes('decide_earning_review_draft'))
        return { rows: [{ result: { status: 'review_recorded' } }] };
      throw new Error('unexpected database statement');
    }
  };
  return { client, calls };
}

test('runner stays dormant without separately approved worker flag', async () => {
  let calls = 0;
  let registered = 0;
  const runner = create(
    {
      query: async () => {
        calls++;
      }
    },
    { launchConfiguration: { ...launch, formalWorkerEnabled: false } }
  );
  assert.equal((await runner.drainDue()).status, 'formal_worker_disabled');
  assert.equal(
    (
      await runner.submitModeration({
        commentId,
        eligible: true,
        rule: 'human',
        reviewReceipt: {}
      })
    ).status,
    'formal_worker_disabled'
  );
  assert.equal(
    runner.bindExistingScheduler({
      registerTick: () => {
        registered++;
      }
    }).status,
    'formal_worker_disabled'
  );
  assert.equal(calls, 0);
  assert.equal(registered, 0);
});

test('review handoff refuses unverified provenance and missing verifier', async () => {
  const { client, calls } = sourceDb();
  const noVerifier = create(client);
  assert.equal(
    (
      await noVerifier.submitModeration({
        commentId,
        eligible: true,
        rule: 'reviewed',
        reviewReceipt: { id: 'x' }
      })
    ).status,
    'review_provenance_missing'
  );
  const rejected = create(client, {
    verifyModeratorReceipt: async () => false
  });
  assert.equal(
    (
      await rejected.submitModeration({
        commentId,
        eligible: true,
        rule: 'reviewed',
        reviewReceipt: { id: 'x' }
      })
    ).status,
    'review_provenance_rejected'
  );
  assert.equal(calls.length, 0);
});

test('trusted reviewer may approve cross-episode identical text after explicit evidence', async () => {
  const prior = { ...comment, id: readId, episode_id: 8 };
  const { client, calls } = sourceDb({ history: [prior] });
  let checked = 0;
  const runner = create(client, {
    verifyModeratorReceipt: async ({
      commentId: id,
      eligible,
      rule,
      reviewReceipt
    }) => {
      checked++;
      return id === commentId &&
        eligible === true &&
        rule === 'manual-relevance-v1' &&
        reviewReceipt.kind === 'trusted-review'
        ? reviewedProof()
        : false;
    }
  });
  const result = await runner.submitModeration({
    commentId,
    eligible: true,
    rule: 'manual-relevance-v1',
    reviewReceipt: { kind: 'trusted-review' }
  });
  assert.equal(result.status, 'review_recorded');
  assert.equal(checked, 1);
  const stored = calls.find(([sql]) =>
    sql.includes('decide_earning_review_draft')
  );
  assert.deepEqual(stored[1], [
    commentId,
    true,
    'manual-relevance-v1',
    reviewerId,
    reviewId,
    reviewedProof().bodySha256,
    9
  ]);
});

test('repetitive text without semantic review remains held, not auto rejected', () => {
  const previous = { ...comment, id: readId, episode_id: 8 };
  const finding = reviewFormalEpisodeComment({
    comment,
    priorUserComments: [previous],
    trustedSourceVerified: true
  });
  assert.equal(finding.status, 'repetitive_text_requires_review');
  assert.equal(finding.mayAward, false);
});

test('verified ineligible blank comment verdict is persisted for later comment progress', async () => {
  const { client, calls } = sourceDb({ body: '　　' });
  const runner = create(client, {
    verifyModeratorReceipt: async () => reviewedProof('　　')
  });
  assert.equal(
    (
      await runner.submitModeration({
        commentId,
        eligible: false,
        rule: 'manual-blank-v1',
        reviewReceipt: {}
      })
    ).status,
    'review_recorded'
  );
  assert.deepEqual(
    calls.find(([sql]) => sql.includes('decide_earning_review_draft'))[1],
    [
      commentId,
      false,
      'manual-blank-v1',
      reviewerId,
      reviewId,
      reviewedProof('　　').bodySha256,
      9
    ]
  );
  const cannotApprove = await runner.submitModeration({
    commentId,
    eligible: true,
    rule: 'manual-eligible',
    reviewReceipt: {}
  });
  assert.equal(cannotApprove.status, 'ineligible_blank');
});

test('reviewer canonical source failure cannot write a verdict', async () => {
  let writes = 0;
  const runner = create(
    {
      query: async (sql) => {
        if (sql.includes('decide_earning_review_draft')) writes++;
        return { rows: [] };
      }
    },
    { verifyModeratorReceipt: async () => reviewedProof() }
  );
  assert.equal(
    (
      await runner.submitModeration({
        commentId,
        eligible: true,
        rule: 'reviewed',
        reviewReceipt: {}
      })
    ).status,
    'canonical_source_missing'
  );
  assert.equal(writes, 0);
});

test('bounded due cycle drains existing durable claims without creating timers', async () => {
  const calls = [];
  let claims = 0;
  const runner = create({
    query: async (sql, params) => {
      calls.push([sql, params]);
      if (sql.includes('claim_earning_draft')) {
        claims++;
        return {
          rows: [
            {
              result:
                claims === 1
                  ? {
                      status: 'leased',
                      event_type: 'valid_read_qualified',
                      event_id: readId,
                      lease_token: token
                    }
                  : { status: 'no_due_event' }
            }
          ]
        };
      }
      if (sql.includes('from public.valid_read_events'))
        return {
          rows: [
            {
              id: readId,
              reader_id: userId,
              episode_id_snapshot: 9,
              qualified_at: '2027-02-01T00:00:00Z'
            }
          ]
        };
      if (sql.includes('award_read_points_draft'))
        return { rows: [{ result: { status: 'already_recorded' } }] };
      if (sql.includes('finish_earning_draft'))
        return { rows: [{ result: { status: 'completed' } }] };
      throw Error('unexpected query');
    }
  });
  const result = await runner.drainDue({ limit: 3 });
  assert.equal(result.status, 'tick_completed');
  assert.equal(result.processed, 1);
  assert.equal(result.completed, 1);
  assert.equal(result.pointsConfirmedByWorker, 0);
  assert.equal(claims, 2);
  assert.deepEqual(
    calls.find(([sql]) => sql.includes('finish_earning_draft'))[1],
    ['valid_read_qualified', readId, token, 'already_recorded']
  );
});

test('one tick cannot overlap itself on a single runner', async () => {
  let unblock;
  let claims = 0;
  const runner = create({
    query: async (sql) => {
      if (sql.includes('claim_earning_draft')) {
        claims++;
        await new Promise((resolve) => {
          unblock = resolve;
        });
        return { rows: [{ result: { status: 'no_due_event' } }] };
      }
      throw Error('unexpected');
    }
  });
  const pending = runner.drainDue({ limit: 1 });
  await Promise.resolve();
  assert.equal(
    (await runner.drainDue({ limit: 1 })).status,
    'tick_already_running'
  );
  unblock();
  assert.equal((await pending).status, 'tick_completed');
  assert.equal(claims, 1);
});

test('unexpected lease, database error and invalid limit fail closed', async () => {
  const bad = create({
    query: async () => ({
      rows: [{ result: { status: 'leased', event_id: readId } }]
    })
  });
  assert.equal((await bad.drainDue({ limit: 2 })).status, 'tick_held');
  assert.equal((await bad.drainDue({ limit: 0 })).status, 'invalid_tick_limit');
  const failing = create({
    query: async () => {
      throw Error('private credentials');
    }
  });
  const result = await failing.drainDue();
  assert.equal(result.status, 'tick_db_unavailable');
  assert.equal(JSON.stringify(result).includes('credentials'), false);
});

test('existing-host scheduler can register a bounded callback only after approval', async () => {
  let task,
    registration = 0,
    unregistered = false;
  const runner = create({
    query: async () => ({ rows: [{ result: { status: 'no_due_event' } }] })
  });
  const binding = runner.bindExistingScheduler({
    limit: 2,
    registerTick: (entry) => {
      registration++;
      task = entry;
      return {
        unregister: () => {
          unregistered = true;
        }
      };
    }
  });
  assert.equal(binding.status, 'scheduler_bound');
  assert.equal(registration, 1);
  assert.equal(task.taskKey, 'novelight-formal-earning-due');
  assert.equal((await task.run()).processed, 0);
  binding.unregister();
  assert.equal(unregistered, true);
});

test('new runner instance can replay a previously persisted retry claim', async () => {
  let claims = 0;
  let awards = 0;
  const client = {
    query: async (sql) => {
      if (sql.includes('claim_earning_draft')) {
        claims++;
        return {
          rows: [
            {
              result:
                claims <= 2
                  ? {
                      status: 'leased',
                      event_type: 'valid_read_qualified',
                      event_id: readId,
                      lease_token: token
                    }
                  : { status: 'no_due_event' }
            }
          ]
        };
      }
      if (sql.includes('from public.valid_read_events'))
        return {
          rows: [
            {
              id: readId,
              reader_id: userId,
              episode_id_snapshot: 9,
              qualified_at: '2027-02-01T00:00:00Z'
            }
          ]
        };
      if (sql.includes('award_read_points_draft')) {
        awards++;
        if (awards <= 2) throw Error('simulated outage');
        return { rows: [{ result: { status: 'recorded' } }] };
      }
      if (sql.includes('finish_earning_draft'))
        return {
          rows: [{ result: { status: awards <= 2 ? 'retry' : 'completed' } }]
        };
      throw Error('unexpected SQL');
    }
  };
  const first = create(client);
  assert.equal((await first.drainDue({ limit: 1 })).retry, 1);
  const recovered = create(client);
  const result = await recovered.drainDue({ limit: 1 });
  assert.equal(result.completed, 1);
  assert.equal(result.processed, 1);
});
