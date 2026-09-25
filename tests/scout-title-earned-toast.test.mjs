import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createScoutBadgeAwardsHandler } from '../api/scout-badge-awards.js';

function responseState() {
  const state = { statusCode: null, body: null, headers: {} };
  return {
    state,
    res: {
      setHeader(name, value) {
        state.headers[name] = value;
      },
      status(code) {
        state.statusCode = code;
        return this;
      },
      json(body) {
        state.body = body;
        return this;
      }
    }
  };
}

function request(overrides = {}) {
  return {
    method: 'GET',
    url: '/api/scout-badge-awards?since=2026-09-25T00%3A00%3A00.000Z',
    headers: { authorization: 'Bearer valid-token' },
    ...overrides
  };
}

test('Scout title award endpoint requires an authenticated cursor request', async () => {
  const calls = [];
  const handler = createScoutBadgeAwardsHandler({
    async authenticateToken(token) {
      calls.push(token);
      return { id: 'user-1' };
    },
    async listAwards() {
      return [];
    }
  });

  for (const req of [
    request({ method: 'POST' }),
    request({ headers: {} }),
    request({ url: '/api/scout-badge-awards?since=not-a-date' })
  ]) {
    const response = responseState();
    await handler(req, response.res);
    assert.ok([400, 401, 405].includes(response.state.statusCode));
    assert.equal(
      response.state.headers['Cache-Control'],
      'private, no-store, max-age=0'
    );
  }

  assert.deepEqual(calls, []);
});

test('Scout title award endpoint returns only the authenticated user award payload', async () => {
  const calls = [];
  const handler = createScoutBadgeAwardsHandler({
    async authenticateToken(token) {
      calls.push({ type: 'auth', token });
      return { id: 'user-1' };
    },
    async listAwards(args) {
      calls.push({ type: 'list', args });
      return [
        {
          badge_id: 'reader_read_005',
          earned_at: '2026-09-25T00:00:01.000Z',
          metadata: {},
          scout_badge_definitions: {
            display_name: 'PAGE WALKER',
            description: '有効読書 5作品'
          }
        }
      ];
    },
    now() {
      return new Date('2026-09-25T00:00:03.000Z');
    }
  });

  const response = responseState();
  await handler(request(), response.res);

  assert.equal(response.state.statusCode, 200);
  assert.deepEqual(response.state.body, {
    cursor: '2026-09-25T00:00:03.000Z',
    awards: [
      {
        badge_id: 'reader_read_005',
        earned_at: '2026-09-25T00:00:01.000Z',
        display_name: 'PAGE WALKER',
        description: '有効読書 5作品',
        metadata: {}
      }
    ]
  });
  assert.deepEqual(calls, [
    { type: 'auth', token: 'valid-token' },
    {
      type: 'list',
      args: {
        userId: 'user-1',
        since: '2026-09-25T00:00:00.000Z',
        through: '2026-09-25T00:00:03.000Z',
        limit: 20
      }
    }
  ]);
});

test('sitewide client installs a compact five-second top-right title toast watcher', async () => {
  const client = await readFile('novelight-client.js', 'utf8');
  const endpoint = await readFile('api/scout-badge-awards.js', 'utf8');

  assert.match(client, /SCOUT_TITLE_TOAST_POLL_MS\s*=\s*3000/u);
  assert.match(client, /SCOUT_TITLE_TOAST_VISIBLE_MS\s*=\s*5000/u);
  assert.match(client, /novelight-scout-title-toast-stack/u);
  assert.match(client, /position:fixed;top:18px;right:18px/u);
  assert.match(client, /達成条件：/u);
  assert.match(client, /visibilitychange/u);
  assert.match(client, /sessionStorage/u);
  assert.match(client, /\/api\/scout-badge-awards\?since=/u);

  assert.match(endpoint, /from\('user_scout_badges'\)/u);
  assert.match(endpoint, /\.eq\('user_id', userId\)/u);
  assert.match(endpoint, /\.gt\('earned_at', since\)/u);
  assert.match(endpoint, /\.lte\('earned_at', through\)/u);
  assert.match(endpoint, /scout_badge_definitions!inner\(display_name,description\)/u);
});
