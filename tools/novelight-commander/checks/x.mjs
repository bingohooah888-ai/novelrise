import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractXStatusId,
  fetchRecentXPosts,
  fetchXPostMetrics,
  normalizeXHandle
} from '../src/x.js';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

test('normalizes X handles and status URLs', () => {
  assert.equal(normalizeXHandle('@NOVELIGHT_jp'), 'NOVELIGHT_jp');
  assert.equal(extractXStatusId('https://x.com/NOVELIGHT_jp/status/1234567890123456789'), '1234567890123456789');
  assert.equal(extractXStatusId('1234567890123456789'), '1234567890123456789');
  assert.throws(() => normalizeXHandle('bad handle'));
  assert.throws(() => extractXStatusId('https://example.com/status/1234567890123456789'));
});

test('reads recent public posts through FxTwitter v2 profile statuses', async () => {
  let requested = null;
  const result = await fetchRecentXPosts('@NOVELIGHT_jp', {
    count: 2,
    fetchImpl: async url => {
      requested = String(url);
      return jsonResponse({
        results: [
          {
            type: 'status',
            id: '1111111111111111111',
            url: 'https://x.com/NOVELIGHT_jp/status/1111111111111111111',
            text: 'first',
            created_at: '2026-09-27T00:00:00Z',
            views: 1200,
            likes: 50,
            reposts: 12,
            replies: 3,
            quotes: 2,
            author: { name: 'NOVELIGHT', screen_name: 'NOVELIGHT_jp' }
          },
          {
            type: 'status',
            id: '2222222222222222222',
            text: 'second',
            views: 800,
            likes: 30,
            reposts: 5,
            replies: 1,
            quotes: 0,
            author: { name: 'NOVELIGHT', screen_name: 'NOVELIGHT_jp' }
          }
        ],
        cursor: { bottom: 'next' }
      });
    }
  });

  assert.match(requested, /\/2\/profile\/NOVELIGHT_jp\/statuses\?count=2$/);
  assert.equal(result.posts.length, 2);
  assert.equal(result.posts[0].metrics.views, 1200);
  assert.equal(result.posts[0].metrics.reposts, 12);
  assert.equal(result.cursor, 'next');
});

test('reads one public post and metrics through FxTwitter v2 status', async () => {
  let requested = null;
  const result = await fetchXPostMetrics(
    'https://x.com/NOVELIGHT_jp/status/3333333333333333333',
    {
      fetchImpl: async url => {
        requested = String(url);
        return jsonResponse({
          code: 200,
          status: {
            type: 'status',
            id: '3333333333333333333',
            text: 'launch post',
            created_at: '2026-09-27T01:00:00Z',
            views: 9876,
            likes: 321,
            reposts: 87,
            replies: 44,
            quotes: 9,
            bookmarks: 15,
            author: { name: 'NOVELIGHT', screen_name: 'NOVELIGHT_jp' }
          }
        });
      }
    }
  );

  assert.equal(requested, 'https://api.fxtwitter.com/2/status/3333333333333333333');
  assert.equal(result.post.metrics.views, 9876);
  assert.equal(result.post.metrics.likes, 321);
  assert.equal(result.post.metrics.replies, 44);
});
