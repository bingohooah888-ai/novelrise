import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareScreenFlow } from './helpers/ai-offline-screen-flow.mjs';
import { createOfflineOwnerEvidenceReader } from '../api/_lib/ai/offline-evidence-review.js';
import { createOfflineAdminAbuseReader } from '../api/_lib/ai/offline-aggregate-review.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic-owner-token-not-a-real-jwt';
const work = { novelId: 1, days: 7, episodeIds: [11] };
const growth = { novelId: 1, days: 7 };
const modelText = JSON.stringify({
  items: [
    {
      kind: 'pacing',
      observation: '架空の改善候補',
      episodeId: '11',
      offset: 0,
      quote: '架空'
    }
  ]
});

function fixture() {
  const state = {
    owner: OWNER,
    plan: 'premium',
    status: 'published',
    episodeNumber: 1,
    active: true,
    continued: 30,
    inconsistent: false,
    calls: []
  };
  const reader = createOfflineOwnerEvidenceReader({
    async verifyUser() {
      return { data: { user: { id: OWNER } } };
    },
    async checkSession() {
      return { active: state.active, binding: 'synthetic-session' };
    },
    async createAuthorClient() {
      return {
        from(table) {
          const filters = {};
          const query = {
            select() {
              return query;
            },
            eq(key, value) {
              filters[key] = value;
              return query;
            },
            in(key, values) {
              assert.equal(key, 'id');
              assert.deepEqual(values, ['11']);
              return query;
            },
            async maybeSingle() {
              if (table === 'profiles') {
                assert.equal(filters.id, OWNER);
                return { data: { id: OWNER, plan: state.plan } };
              }
              assert.equal(table, 'novels');
              assert.equal(filters.id, '1');
              assert.equal(filters.user_id, OWNER);
              return { data: { id: 1, user_id: state.owner } };
            },
            async limit() {
              assert.equal(table, 'episodes');
              assert.equal(filters.novel_id, '1');
              assert.equal(filters.user_id, OWNER);
              return {
                data: [
                  {
                    id: 11,
                    novel_id: 1,
                    user_id: OWNER,
                    episode_number: state.episodeNumber,
                    status: state.status,
                    title: '門',
                    content: '架空の原稿'
                  }
                ]
              };
            }
          };
          return query;
        },
        async rpc(name, args) {
          assert.deepEqual(args, { p_days: 7 });
          state.calls.push(name);
          if (name === 'novelight_author_exposure_funnel_v2') {
            return {
              data: [
                {
                  novel_id: '1',
                  first_episode_reads_10s: 80,
                  continued_to_episode_2: state.continued
                },
                {
                  novel_id: '2',
                  title: 'UNSELECTED_WORK',
                  first_episode_reads_10s: 100,
                  continued_to_episode_2: 50
                }
              ]
            };
          }
          assert.equal(name, 'novelight_author_analytics_timeseries');
          return {
            data: Array.from({ length: 7 }, (_, index) => ({
              bucket_date: '2026-11-0' + (index + 1),
              current_first_episode_reads_10s: 80,
              current_continued_to_episode_2:
                state.continued + (state.inconsistent && index === 1 ? 1 : 0),
              previous_first_episode_reads_10s: 100,
              previous_continued_to_episode_2: 40
            }))
          };
        }
      };
    },
    nowEpochSeconds: () => 1800000000
  });
  return { state, reader };
}

for (const [feature, kind] of [
  ['analytics-copilot', 'analytics_review'],
  ['reader-dropoff-analysis', 'continuation_review_candidates']
]) {
  test('scoped work analytics: ' + feature, async () => {
    const { reader, state } = fixture();
    const prepared = await prepareScreenFlow('owner', reader, feature, work, {
      token: TOKEN
    });
    assert.doesNotMatch(prepared.prompt.user, /UNSELECTED_WORK/u);
    const response = { requestHash: prepared.requestHash, modelText };
    const result = await prepared.review(response, '架空の改善候補');
    assert.equal(result.kind, kind);
    assert.equal(result.observed.cohort.started, 80);
    assert.equal(result.observed.cohort.continued, 30);
    assert.equal(result.causalRelationshipVerified, false);
    assert.equal(result.dropoffLocationVerified, false);
    state.continued = 31;
    await assert.rejects(reader.review(feature, work, TOKEN, response));
    state.continued = 30;
    state.plan = 'free';
    await assert.rejects(reader.review(feature, work, TOKEN, response));
  });
}

test('work analytics reject missing scope, draft and small cells', async () => {
  const { reader, state } = fixture();
  const feature = 'reader-dropoff-analysis';
  state.owner = OTHER;
  await assert.rejects(reader.prepare(feature, work, TOKEN));
  assert.equal(state.calls.length, 0);
  state.owner = OWNER;
  state.episodeNumber = 2;
  await assert.rejects(reader.prepare(feature, work, TOKEN));
  state.episodeNumber = 1;
  state.status = 'draft';
  await assert.rejects(reader.prepare(feature, work, TOKEN));
  state.status = 'published';
  state.continued = 3;
  await assert.rejects(reader.prepare(feature, work, TOKEN));
  const injected = { ...work, plan: 'premium' };
  await assert.rejects(reader.prepare(feature, injected, TOKEN));
});

test('growth uses author-wide period totals once, not daily sums', async () => {
  const { reader, state } = fixture();
  const feature = 'author-growth-report';
  const prepared = await prepareScreenFlow('owner', reader, feature, growth, {
    token: TOKEN
  });
  const response = {
    requestHash: prepared.requestHash,
    modelText: '{"metric":"first_to_second_continuation"}'
  };
  const result = await prepared.review(response, '80');
  assert.equal(result.scope, 'author_all_works');
  assert.equal(result.current.started, 80);
  assert.equal(result.previous.started, 100);
  assert.equal(result.improvementVerified, false);
  state.inconsistent = true;
  await assert.rejects(reader.prepare(feature, growth, TOKEN));
  state.inconsistent = false;
  state.active = false;
  await assert.rejects(reader.review(feature, growth, TOKEN, response));
});

test('abuse reader uses admin allowlist and only bounded signal columns', async () => {
  let actor = OWNER;
  let status = 'active';
  let reads = 0;
  const signal = '33333333-3333-4333-8333-333333333333';
  const supabase = {
    auth: {
      async getUser(token) {
        assert.equal(token, TOKEN);
        return { data: { user: { id: actor } } };
      }
    },
    from(table) {
      assert.equal(table, 'trust_risk_signals');
      reads++;
      const query = {
        select(columns) {
          assert.equal(columns, 'id,status,signal_type');
          return query;
        },
        in(column, values) {
          if (column === 'status') {
            assert.deepEqual(values, ['active', 'confirmed']);
          } else {
            assert.equal(column, 'signal_type');
            assert.ok(values.includes('robotic_valid_read_burst'));
          }
          return query;
        },
        order() {
          return query;
        },
        async limit(n) {
          assert.equal(n, 200);
          return {
            data: [
              {
                id: signal,
                status,
                signal_type: 'robotic_valid_read_burst',
                user_id: 'PRIVATE_USER',
                evidence: 'PRIVATE_EVIDENCE'
              }
            ]
          };
        }
      };
      return query;
    }
  };
  const reader = createOfflineAdminAbuseReader({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: OWNER }
  });
  const req = { headers: { authorization: 'Bearer ' + TOKEN } };
  const res = {
    setHeader() {},
    status() {
      return res;
    },
    json() {}
  };
  const prepared = await prepareScreenFlow(
    'abuse',
    reader,
    'abuse-analysis',
    {},
    { req, res }
  );
  assert.doesNotMatch(prepared.prompt.user, /PRIVATE_USER|PRIVATE_EVIDENCE/u);
  const response = {
    requestHash: prepared.requestHash,
    modelText: JSON.stringify({ ids: [signal] })
  };
  const result = await prepared.review(response, 'robotic_valid_read_burst');
  assert.equal(result.abuseVerified, false);
  assert.equal(result.items[0].id, signal);
  status = 'confirmed';
  await assert.rejects(reader.review(req, res, response));
  actor = OTHER;
  const before = reads;
  await assert.rejects(reader.prepare(req, res));
  assert.equal(reads, before);
});
