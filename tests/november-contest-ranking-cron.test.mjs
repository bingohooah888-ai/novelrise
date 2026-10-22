import assert from 'node:assert/strict';
import test from 'node:test';
import { createContestRankingPrepareHandler } from '../api/_lib/november-contest-ranking-cron.js';

const CONTEST = 'caf00000-0000-4000-8000-000000000090';

function database() {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        calls.push(table);
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return {
              data: { id: CONTEST, status: 'active', public_visible: true },
              error: null
            };
          }
        };
      },
      async rpc(name, args) {
        calls.push([name, args]);
        return { data: { ok: true }, error: null };
      }
    }
  };
}

function res() {
  return {
    statusCode: 200,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

test('cron is inert by default, even with the correct secret', async () => {
  const { client, calls } = database();
  const handler = createContestRankingPrepareHandler({
    supabase: client,
    env: { CRON_SECRET: 'genuine-secret' },
    now: () => new Date('2026-12-07T03:00:00Z')
  });
  const response = res();
  await handler(
    {
      method: 'GET',
      headers: { authorization: 'Bearer genuine-secret' }
    },
    response
  );
  assert.equal(response.statusCode, 403);
  assert.equal(calls.length, 0);
});

test('cron fails closed outside exactly three JST noon slots', async () => {
  const { client, calls } = database();
  const env = {
    CRON_SECRET: 'genuine-secret',
    NOVELIGHT_CONTEST_RANKING_AUTO_PREP_ENABLED: 'true'
  };
  for (const iso of [
    '2026-12-06T03:00:00Z',
    '2026-12-07T02:59:59Z',
    '2026-12-07T03:15:00Z',
    '2026-12-15T02:00:00Z',
    '2026-12-23T03:00:00Z'
  ]) {
    const handler = createContestRankingPrepareHandler({
      supabase: client,
      env,
      now: () => new Date(iso)
    });
    const response = res();
    await handler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer genuine-secret' }
      },
      response
    );
    assert.equal(response.statusCode, 409);
  }
  assert.equal(calls.length, 0);
});

test('cron never publishes, even in an approved private preparation window', async () => {
  const { client, calls } = database();
  const handler = createContestRankingPrepareHandler({
    supabase: client,
    env: {
      CRON_SECRET: 'genuine-secret',
      NOVELIGHT_CONTEST_RANKING_AUTO_PREP_ENABLED: 'true'
    },
    now: () => new Date('2026-12-15T03:04:00Z')
  });
  const response = res();
  await handler(
    {
      method: 'GET',
      headers: { authorization: 'Bearer genuine-secret' }
    },
    response
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.published, false);
  assert.deepEqual(calls[1], [
    'novelight_contest_auto_prepare_rank_slot',
    { p_contest_id: CONTEST, p_slot: 2 }
  ]);
  assert.ok(!calls.some((entry) => String(entry).includes('publish')));
});

test('wrong secret is rejected before Supabase read', async () => {
  const { client, calls } = database();
  const handler = createContestRankingPrepareHandler({
    supabase: client,
    env: {
      CRON_SECRET: 'real-secret',
      NOVELIGHT_CONTEST_RANKING_AUTO_PREP_ENABLED: 'true'
    },
    now: () => new Date('2026-12-22T03:00:00Z')
  });
  const response = res();
  await handler(
    {
      method: 'GET',
      headers: { authorization: 'Bearer evil-secret' }
    },
    response
  );
  assert.equal(response.statusCode, 403);
  assert.equal(calls.length, 0);
});
