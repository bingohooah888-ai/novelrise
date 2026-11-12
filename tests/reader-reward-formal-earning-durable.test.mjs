import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormalDurableDelivery } from '../api/_lib/reader-reward/formal-earning-durable.js';

const uid = '00000000-0000-4000-8000-000000000081';
const token = '00000000-0000-4000-8000-000000000082';
const config = { formalEarningsEnabled: true, productionCutoverApproved: true };
const auth = { serviceRoleVerified: true, verifiedByTrustedServer: true };
const release = '2027-01-01T00:00:00Z';
test('dormant durable handler never touches DB without launch approval', async () => {
  let calls = 0;
  const d = createFormalDurableDelivery({
    postgresClient: {
      query: async () => {
        calls++;
      }
    },
    releaseTimestampIso: release,
    launchConfiguration: { formalEarningsEnabled: false },
    trustedServerAuthorization: auth
  });
  assert.equal(
    (await d.enqueue('valid_read_qualified', uid)).status,
    'formal_connection_disabled'
  );
  assert.equal(
    (await d.resolveReview(uid, true, 'verified')).status,
    'formal_connection_disabled'
  );
  assert.equal((await d.processNext()).status, 'formal_connection_disabled');
  assert.equal(calls, 0);
});
test('same canonical event may be enqueued and claimed through fixed bound SQL', async () => {
  const calls = [];
  const db = {
    query: async (sql, values) => {
      calls.push([sql, values]);
      return {
        rows: [
          {
            result: { status: calls.length === 1 ? 'pending' : 'no_due_event' }
          }
        ]
      };
    }
  };
  const d = createFormalDurableDelivery({
    postgresClient: db,
    releaseTimestampIso: release,
    launchConfiguration: config,
    trustedServerAuthorization: auth
  });
  assert.equal(
    (await d.enqueue('valid_read_qualified', uid)).status,
    'pending'
  );
  assert.equal((await d.processNext()).status, 'no_due_event');
  assert.match(calls[0][0], /enqueue_earning_draft/);
  assert.deepEqual(calls[0][1], ['valid_read_qualified', uid]);
  assert.match(calls[1][0], /claim_earning_draft/);
});
test('durable claim runs canonical read pipeline, then finalizes with same lease token', async () => {
  const calls = [];
  const client = {
    query: async (sql, values) => {
      calls.push([sql, values]);
      if (sql.includes('claim_earning_draft'))
        return {
          rows: [
            {
              result: {
                status: 'leased',
                event_type: 'valid_read_qualified',
                event_id: uid,
                lease_token: token
              }
            }
          ]
        };
      if (sql.includes('from public.valid_read_events'))
        return {
          rows: [
            {
              id: uid,
              reader_id: uid,
              episode_id_snapshot: 9,
              qualified_at: '2027-02-01T00:00:00Z'
            }
          ]
        };
      if (sql.includes('award_read_points_draft'))
        return { rows: [{ result: { status: 'already_recorded' } }] };
      if (sql.includes('finish_earning_draft'))
        return { rows: [{ result: { status: 'completed' } }] };
      throw Error('Unexpected SQL');
    }
  };
  const d = createFormalDurableDelivery({
    postgresClient: client,
    releaseTimestampIso: release,
    launchConfiguration: config,
    trustedServerAuthorization: auth
  });
  const result = await d.processNext();
  assert.equal(result.status, 'completed');
  assert.equal(result.deliveryStatus, 'already_recorded');
  const finishing = calls.find(([sql]) => sql.includes('finish_earning_draft'));
  assert.deepEqual(finishing[1], [
    'valid_read_qualified',
    uid,
    token,
    'already_recorded'
  ]);
});
test('durable retry never advertises a completed new award even after a recorded delivery', async () => {
  const db = {
    query: async (sql) => {
      if (sql.includes('claim_earning_draft'))
        return {
          rows: [
            {
              result: {
                status: 'leased',
                event_type: 'valid_read_qualified',
                event_id: uid,
                lease_token: token
              }
            }
          ]
        };
      if (sql.includes('from public.valid_read_events'))
        return {
          rows: [
            {
              id: uid,
              reader_id: uid,
              episode_id_snapshot: 9,
              qualified_at: '2027-02-01T00:00:00Z'
            }
          ]
        };
      if (sql.includes('award_read_points_draft'))
        return { rows: [{ result: { status: 'recorded' } }] };
      if (sql.includes('finish_earning_draft'))
        return { rows: [{ result: { status: 'retry' } }] };
      throw new Error('Unexpected SQL');
    }
  };
  const d = createFormalDurableDelivery({
    postgresClient: db,
    releaseTimestampIso: release,
    launchConfiguration: config,
    trustedServerAuthorization: auth
  });
  const outcome = await d.processNext();
  assert.equal(outcome.deliveryStatus, 'recorded');
  assert.equal(outcome.status, 'retry');
  assert.equal(outcome.mayIssuePoints, false);
});

test('reviewed ineligible comment may be delivered without credit and persisted as final', async () => {
  const comment = {
    id: uid,
    user_id: '00000000-0000-4000-8000-000000000083',
    episode_id: 9,
    body: 'Not relevant',
    created_at: '2027-02-01T02:00:00Z',
    deleted_at: null,
    author_hidden_at: null
  };
  let reviewArg, finished;
  const client = {
    query: async (sql, values) => {
      if (sql.includes('claim_earning_draft'))
        return {
          rows: [
            {
              result: {
                status: 'leased',
                event_type: 'novel_episode_comment_reviewed',
                event_id: uid,
                lease_token: token,
                moderation_decision: false,
                moderation_rule: 'reviewed-ineligible'
              }
            }
          ]
        };
      if (sql.includes('from public.novel_comments where id='))
        return { rows: [comment] };
      if (sql.includes('from public.novel_comments where user_id='))
        return { rows: [] };
      if (sql.includes('review_comment_and_award_draft')) {
        reviewArg = values;
        return { rows: [{ result: { status: 'reviewed_not_eligible' } }] };
      }
      if (sql.includes('finish_earning_draft')) {
        finished = values;
        return { rows: [{ result: { status: 'completed' } }] };
      }
      throw Error('Unexpected SQL');
    }
  };
  const d = createFormalDurableDelivery({
    postgresClient: client,
    releaseTimestampIso: release,
    launchConfiguration: config,
    trustedServerAuthorization: auth
  });
  const result = await d.processNext();
  assert.equal(result.deliveryStatus, 'reviewed_not_eligible');
  assert.equal(result.mayIssuePoints, false);
  assert.deepEqual(reviewArg, [uid, release, false, 'reviewed-ineligible']);
  assert.equal(finished[3], 'reviewed_not_eligible');
});
test('retryable failure retained for future manual invocation', async () => {
  let finished;
  const db = {
    query: async (sql, values) => {
      if (sql.includes('claim_earning_draft'))
        return {
          rows: [
            {
              result: {
                status: 'leased',
                event_type: 'valid_read_qualified',
                event_id: uid,
                lease_token: token
              }
            }
          ]
        };
      if (sql.includes('from public.valid_read_events'))
        return {
          rows: [
            {
              id: uid,
              reader_id: uid,
              episode_id_snapshot: 9,
              qualified_at: '2027-02-01T00:00:00Z'
            }
          ]
        };
      if (sql.includes('award_read_points_draft'))
        throw Error('temporary provider outage');
      if (sql.includes('finish_earning_draft')) {
        finished = values;
        return { rows: [{ result: { status: 'retry' } }] };
      }
      throw Error('unexpected query');
    }
  };
  const d = createFormalDurableDelivery({
    postgresClient: db,
    releaseTimestampIso: release,
    launchConfiguration: config,
    trustedServerAuthorization: auth
  });
  const result = await d.processNext();
  assert.equal(result.status, 'retry');
  assert.equal(finished[3], 'private_rpc_failed');
});
