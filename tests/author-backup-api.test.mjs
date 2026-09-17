import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAuthorBackupText,
  createAuthorBackupHandler
} from '../api/export-author-backup.js';

function responseRecorder() {
  const headers = new Map();
  return {
    statusCode: null,
    body: null,
    headers,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    }
  };
}

function baseDependencies(overrides = {}) {
  return {
    authenticate: async () => ({ id: 'user-1' }),
    beginExport: async () => 17,
    loadNovels: async () => [],
    loadEpisodes: async () => [],
    completeExport: async () => {},
    failExport: async () => {},
    now: () => new Date('2026-09-17T00:00:00.000Z'),
    ...overrides
  };
}

test('author backup requires POST and bearer authentication', async () => {
  const handler = createAuthorBackupHandler(baseDependencies());

  const getResponse = responseRecorder();
  await handler({ method: 'GET', headers: {} }, getResponse);
  assert.equal(getResponse.statusCode, 405);

  const noTokenResponse = responseRecorder();
  await handler({ method: 'POST', headers: {} }, noTokenResponse);
  assert.equal(noTokenResponse.statusCode, 401);
});

test('author backup returns 429 when the database rate limit is reached', async () => {
  const handler = createAuthorBackupHandler(
    baseDependencies({
      beginExport: async () => {
        throw new Error('author_backup_rate_limit');
      }
    })
  );
  const res = responseRecorder();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-1' }
    },
    res
  );

  assert.equal(res.statusCode, 429);
  assert.equal(res.body.code, 'author_backup_rate_limit');
  assert.equal(res.headers.get('retry-after'), '3600');
});

test('author backup exports only data supplied for the authenticated author and audits counts', async () => {
  const completed = [];
  const handler = createAuthorBackupHandler(
    baseDependencies({
      loadNovels: async (userId) => {
        assert.equal(userId, 'user-1');
        return [
          {
            id: 10,
            title: '光の物語',
            description: '説明文',
            genre: 'ファンタジー',
            status: 'published',
            ai_usage: 'human',
            content_rating: 'general',
            content_warnings: [],
            created_at: '2026-09-01T00:00:00Z',
            first_published_at: '2026-09-02T00:00:00Z'
          }
        ];
      },
      loadEpisodes: async (userId) => {
        assert.equal(userId, 'user-1');
        return [
          {
            id: 101,
            novel_id: 10,
            episode_number: 1,
            title: '第一話',
            content: '改行を\n保った本文',
            status: 'published',
            created_at: '2026-09-02T00:00:00Z',
            updated_at: '2026-09-03T00:00:00Z',
            scheduled_publish_at: null
          }
        ];
      },
      completeExport: async (...args) => completed.push(args)
    })
  );
  const res = responseRecorder();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-1' }
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.match(
    res.headers.get('content-disposition'),
    /novelight-backup-2026-09-17\.txt/
  );
  assert.match(res.body, /光の物語/);
  assert.match(res.body, /改行を\n保った本文/);
  assert.deepEqual(completed, [
    [
      17,
      'user-1',
      {
        novelCount: 1,
        episodeCount: 1,
        completedAt: '2026-09-17T00:00:00.000Z'
      }
    ]
  ]);
});

test('request body cannot override the authenticated author ownership boundary', async () => {
  const seen = [];
  const handler = createAuthorBackupHandler(
    baseDependencies({
      beginExport: async (userId) => {
        seen.push(['begin', userId]);
        return 18;
      },
      loadNovels: async (userId) => {
        seen.push(['novels', userId]);
        return [];
      },
      loadEpisodes: async (userId) => {
        seen.push(['episodes', userId]);
        return [];
      },
      completeExport: async (exportId, userId) => {
        seen.push(['complete', exportId, userId]);
      }
    })
  );
  const res = responseRecorder();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-1' },
      body: { userId: 'user-2', novelId: 'someone-elses-work' }
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, [
    ['begin', 'user-1'],
    ['novels', 'user-1'],
    ['episodes', 'user-1'],
    ['complete', 18, 'user-1']
  ]);
});

test('failed manuscript load marks the claimed audit row failed', async () => {
  const failed = [];
  const handler = createAuthorBackupHandler(
    baseDependencies({
      loadNovels: async () => {
        throw new Error('database unavailable');
      },
      failExport: async (...args) => failed.push(args)
    })
  );
  const res = responseRecorder();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-1' }
    },
    res
  );

  assert.equal(res.statusCode, 500);
  assert.deepEqual(failed, [[17, 'user-1']]);
});

test('backup text preserves owned episodes whose novel relation is missing', () => {
  const text = buildAuthorBackupText({
    novels: [],
    episodes: [
      {
        id: 999,
        novel_id: 404,
        episode_number: 3,
        title: '孤立本文',
        content: '消さない本文',
        status: 'draft'
      }
    ],
    generatedAt: new Date('2026-09-17T00:00:00Z')
  });

  assert.match(text, /関連作品を確認できなかったエピソード/);
  assert.match(text, /消さない本文/);
});
