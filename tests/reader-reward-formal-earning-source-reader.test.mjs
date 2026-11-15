import assert from 'node:assert/strict';
import test from 'node:test';
import { createFormalCanonicalSourceReader } from '../api/_lib/reader-reward/formal-earning-source-reader.js';
import { reviewFormalEpisodeComment } from '../api/_lib/reader-reward/formal-comment-eligibility.js';
import { createFormalEarningInternalHandler } from '../api/_lib/reader-reward/formal-earning-server-connection.js';
import {
  deliverFormalRewardBatch,
  createFormalEarningDeliveryPipeline
} from '../api/_lib/reader-reward/formal-earning-delivery.js';
const id = '00000000-0000-4000-8000-000000000091';
const user = '00000000-0000-4000-8000-000000000092';
const time = '2027-02-01T00:10:00Z';
test('canonical source reader uses fixed bound SQL for read events', async () => {
  const calls = [];
  const reader = createFormalCanonicalSourceReader({
    postgresClient: {
      query: async (sql, params) => {
        calls.push([sql, params]);
        return {
          rows: [
            { id, reader_id: user, episode_id_snapshot: 22, qualified_at: time }
          ]
        };
      }
    }
  });
  const r = await reader.load('valid_read_qualified', id);
  assert.equal(r.status, 'canonical_source_verified');
  assert.deepEqual(calls[0][1], [id]);
  assert.match(
    calls[0][0],
    /from public\.valid_read_events where id=\$1::uuid/
  );
});

test('read reward source fails closed when canonical qualification fields are absent or invalid', async () => {
  const valid = {
    id,
    reader_id: user,
    episode_id_snapshot: '22',
    qualified_at: new Date(time)
  };
  for (const bad of [
    { id },
    { ...valid, reader_id: null },
    { ...valid, reader_id: 'not-a-reader-uuid' },
    { ...valid, episode_id_snapshot: null },
    { ...valid, episode_id_snapshot: '9007199254740992' },
    { ...valid, episode_id_snapshot: 0 },
    { ...valid, qualified_at: null },
    { ...valid, qualified_at: 'invalid-date' }
  ]) {
    const reader = createFormalCanonicalSourceReader({
      postgresClient: { query: async () => ({ rows: [bad] }) }
    });
    assert.equal(
      (await reader.load('valid_read_qualified', id)).status,
      'canonical_source_invalid'
    );
  }
  const reader = createFormalCanonicalSourceReader({
    postgresClient: { query: async () => ({ rows: [valid] }) }
  });
  assert.equal(
    (await reader.load('valid_read_qualified', id)).status,
    'canonical_source_verified'
  );
});
test('read comment and previous same-user comments only from canonical server DB', async () => {
  const calls = [];
  const comment = {
    id,
    user_id: user,
    episode_id: 22,
    body: '展開が面白いです',
    deleted_at: null,
    author_hidden_at: null,
    created_at: time
  };
  const reader = createFormalCanonicalSourceReader({
    postgresClient: {
      query: async (sql, params) => {
        calls.push([sql, params]);
        return { rows: calls.length === 1 ? [comment] : [] };
      }
    }
  });
  const r = await reader.load('novel_episode_comment_reviewed', id);
  assert.equal(r.status, 'canonical_source_verified');
  assert.deepEqual(r.verifiedComment, comment);
  assert.deepEqual(calls[1][1], [user, id, time]);
  assert.match(
    calls[1][0],
    /from public\.novel_comments where user_id=\$1::uuid/
  );
});
test('PostgreSQL bigint comment episode IDs support canonical moderation', async () => {
  const comment = {
    id,
    user_id: user,
    episode_id: '22',
    body: '結末が良かった',
    deleted_at: null,
    author_hidden_at: null,
    created_at: new Date(time)
  };
  const previous = {
    id: '00000000-0000-4000-8000-000000000093',
    user_id: user,
    episode_id: '21',
    body: '以前の感想'
  };
  let queries = 0;
  const reader = createFormalCanonicalSourceReader({
    postgresClient: {
      query: async () => ({ rows: ++queries === 1 ? [comment] : [previous] })
    }
  });
  const result = await reader.load('novel_episode_comment_reviewed', id);
  assert.equal(result.status, 'canonical_source_verified');
  assert.equal(result.verifiedComment.episode_id, 22);
  assert.equal(result.verifiedPriorUserComments[0].episode_id, 21);
  assert.equal(
    reviewFormalEpisodeComment({
      comment: result.verifiedComment,
      priorUserComments: result.verifiedPriorUserComments,
      trustedSourceVerified: true,
      reviewerDecision: 'eligible',
      reviewerRule: 'human-v1'
    }).status,
    'reviewed_eligible'
  );
});

test('malformed or unsafe PostgreSQL bigint episode IDs fail closed', async () => {
  for (const episodeId of ['9007199254740993', '0', '-1', '02', 'bad', null]) {
    let queries = 0;
    const reader = createFormalCanonicalSourceReader({
      postgresClient: {
        query: async () => {
          queries++;
          return {
            rows: [
              {
                id,
                user_id: user,
                episode_id: episodeId,
                body: '内容',
                created_at: new Date(time),
                deleted_at: null,
                author_hidden_at: null
              }
            ]
          };
        }
      }
    });
    assert.equal(
      (await reader.load('novel_episode_comment_reviewed', id)).status,
      'canonical_source_invalid'
    );
    assert.equal(queries, 1, 'invalid event must not query history');
  }
});

test('canonical source reader rejects absent rows and history truncation', async () => {
  const absent = createFormalCanonicalSourceReader({
    postgresClient: { query: async () => ({ rows: [] }) }
  });
  assert.equal(
    (await absent.load('valid_read_qualified', id)).status,
    'canonical_source_missing'
  );
  assert.equal(
    (await absent.load('invalid', id)).status,
    'unsupported_source_event'
  );
  const comment = {
    id,
    user_id: user,
    episode_id: 22,
    body: '作品感想',
    created_at: time
  };
  let calls = 0;
  const full = createFormalCanonicalSourceReader({
    postgresClient: {
      query: async () => {
        calls++;
        return { rows: calls === 1 ? [comment] : Array(201).fill(comment) };
      }
    }
  });
  assert.equal(
    (await full.load('novel_episode_comment_reviewed', id)).status,
    'history_limit_requires_review'
  );
});
test('full inert server integration checks source, moderation, and runs bound SQL only when allowed', async () => {
  let writes = 0;
  const comment = {
    id,
    user_id: user,
    episode_id: 22,
    body: '物語の伏線が面白い',
    deleted_at: null,
    author_hidden_at: null,
    created_at: time
  };
  const client = {
    query: async (sql, params) => {
      if (sql.includes('from public.novel_comments where id='))
        return { rows: [comment] };
      if (sql.includes('from public.novel_comments where user_id='))
        return { rows: [] };
      if (sql.includes('review_comment_and_award_draft(')) {
        writes++;
        assert.deepEqual(params, [
          id,
          '2027-01-01T00:00:00Z',
          true,
          'human-reviewed-v1'
        ]);
        return { rows: [{ result: { status: 'recorded', points: 20 } }] };
      }
      throw Error('unexpected SQL');
    }
  };
  const reader = createFormalCanonicalSourceReader({ postgresClient: client });
  const evidence = await reader.load('novel_episode_comment_reviewed', id);
  const handler = createFormalEarningInternalHandler({
    postgresClient: client,
    releaseTimestampIso: '2027-01-01T00:00:00Z',
    launchConfiguration: {
      formalEarningsEnabled: true,
      productionCutoverApproved: true
    },
    trustedServerAuthorization: {
      serviceRoleVerified: true,
      verifiedByTrustedServer: true
    }
  });
  const result = await deliverFormalRewardBatch({
    events: [
      {
        ...evidence,
        verifiedEventId: id,
        sourceCommitted: true,
        authoritativeEvidenceVerified: true,
        trustedSourceVerified: true,
        reviewerDecision: 'eligible',
        reviewerRule: 'human-reviewed-v1'
      }
    ],
    internalHandler: handler
  });
  assert.equal(result.results[0].status, 'recorded');
  assert.equal(writes, 1);
});

test('composed private pipeline loads database rows and dispatches reviewed comment once', async () => {
  let writes = 0;
  const comment = {
    id,
    user_id: user,
    episode_id: 22,
    body: '作品の描写が良かったです',
    created_at: time,
    deleted_at: null,
    author_hidden_at: null
  };
  const client = {
    query: async (sql, params) => {
      if (sql.includes('from public.novel_comments where id='))
        return { rows: [comment] };
      if (sql.includes('from public.novel_comments where user_id='))
        return { rows: [] };
      if (sql.includes('review_comment_and_award_draft(')) {
        writes++;
        assert.deepEqual(params, [
          id,
          '2027-01-01T00:00:00Z',
          true,
          'reviewed-v1'
        ]);
        return { rows: [{ result: { status: 'recorded', points: 20 } }] };
      }
      throw Error('Unexpected source query');
    }
  };
  const pipeline = createFormalEarningDeliveryPipeline({
    postgresClient: client,
    releaseTimestampIso: '2027-01-01T00:00:00Z',
    launchConfiguration: {
      formalEarningsEnabled: true,
      productionCutoverApproved: true
    },
    trustedServerAuthorization: {
      serviceRoleVerified: true,
      verifiedByTrustedServer: true
    }
  });
  const r = await pipeline.deliverVerifiedEvent({
    eventType: 'novel_episode_comment_reviewed',
    eventId: id,
    moderationDecision: 'eligible',
    moderationRule: 'reviewed-v1',
    trustedModeratorVerified: true
  });
  assert.equal(r.status, 'recorded');
  assert.equal(writes, 1);
});
test('composed pipeline refuses absent moderator or disabled formal launch', async () => {
  let writes = 0;
  const comment = {
    id,
    user_id: user,
    episode_id: 22,
    body: '本の感想です',
    created_at: time,
    deleted_at: null,
    author_hidden_at: null
  };
  const client = {
    query: async (sql) => {
      if (sql.includes('from public.novel_comments where id='))
        return { rows: [comment] };
      if (sql.includes('from public.novel_comments where user_id='))
        return { rows: [] };
      writes++;
      return { rows: [{ result: { status: 'recorded' } }] };
    }
  };
  const build = (enabled) =>
    createFormalEarningDeliveryPipeline({
      postgresClient: client,
      releaseTimestampIso: '2027-01-01T00:00:00Z',
      launchConfiguration: {
        formalEarningsEnabled: enabled,
        productionCutoverApproved: enabled
      },
      trustedServerAuthorization: {
        serviceRoleVerified: true,
        verifiedByTrustedServer: true
      }
    });
  const withoutReview = await build(true).deliverVerifiedEvent({
    eventType: 'novel_episode_comment_reviewed',
    eventId: id,
    moderationDecision: 'eligible',
    moderationRule: 'r-v1',
    trustedModeratorVerified: false
  });
  assert.equal(withoutReview.status, 'semantic_review_required');
  const disabled = await build(false).deliverVerifiedEvent({
    eventType: 'novel_episode_comment_reviewed',
    eventId: id,
    moderationDecision: 'eligible',
    moderationRule: 'r-v1',
    trustedModeratorVerified: true
  });
  assert.equal(disabled.status, 'formal_connection_disabled');
  assert.equal(writes, 0);
});
