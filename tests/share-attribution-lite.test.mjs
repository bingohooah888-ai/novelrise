import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

import { isInternalReferral } from '../api/analytics-event.js';
import { createAuthorShareAttributionHandler } from '../api/author-share-attribution.js';

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: new Map(),
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function queryBuilder(result, calls, table) {
  const chain = {
    select(columns, options) {
      calls.push(['select', table, columns, options || null]);
      return chain;
    },
    eq(column, value) {
      calls.push(['eq', table, column, value]);
      return chain;
    },
    in(column, values) {
      calls.push(['in', table, column, values]);
      return chain;
    },
    gte(column, value) {
      calls.push(['gte', table, column, value]);
      return Promise.resolve(result);
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    }
  };
  return chain;
}

test('self-referral guard ignores only exact NOVELIGHT internal referral hosts', () => {
  assert.equal(
    isInternalReferral({ source: 'referral', referrer_host: 'novelight.jp' }),
    true
  );
  assert.equal(
    isInternalReferral({
      source: 'referral',
      referrer_host: 'www.novelight.jp'
    }),
    true
  );
  assert.equal(
    isInternalReferral({
      source: 'referral',
      referrer_host: 'novelrise.vercel.app'
    }),
    true
  );
  assert.equal(
    isInternalReferral({ source: 'referral', referrer_host: 'vercel.com' }),
    false
  );
  assert.equal(
    isInternalReferral({
      source: 'referral',
      referrer_host: 'novelrise-preview-123.vercel.app'
    }),
    false
  );
  assert.equal(
    isInternalReferral({
      source: 'x',
      campaign: 'novelight_work_share',
      content: 'novel:abc',
      referrer_host: 'novelight.jp'
    }),
    false
  );
});

test('author referral-lite endpoint counts only works owned by the authenticated author', async () => {
  const calls = [];
  const supabase = {
    auth: {
      async getUser(token) {
        assert.equal(token, 'valid-token');
        return { data: { user: { id: 'author-1' } }, error: null };
      }
    },
    from(table) {
      if (table === 'novels') {
        return queryBuilder(
          { data: [{ id: 'work-a' }, { id: 'work-b' }], error: null },
          calls,
          table
        );
      }
      if (table === 'acquisition_touches') {
        return queryBuilder({ count: 12, error: null }, calls, table);
      }
      if (table === 'user_acquisition') {
        return queryBuilder({ count: 3, error: null }, calls, table);
      }
      throw new Error(`unexpected table ${table}`);
    }
  };

  const handler = createAuthorShareAttributionHandler({ supabase });
  const res = response();
  await handler(
    {
      method: 'GET',
      headers: { authorization: 'Bearer valid-token' },
      query: { days: '30' }
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { days: 30, visits: 12, registrations: 3 });
  assert.deepEqual(
    calls.find((call) => call[0] === 'eq' && call[1] === 'novels'),
    ['eq', 'novels', 'user_id', 'author-1']
  );
  for (const table of ['acquisition_touches', 'user_acquisition']) {
    const contentFilter = calls.find(
      (call) => call[0] === 'in' && call[1] === table
    );
    assert.deepEqual(contentFilter, [
      'in',
      table,
      'content',
      ['novel:work-a', 'novel:work-b']
    ]);
  }
  assert.ok(
    calls.some(
      (call) =>
        call[0] === 'gte' &&
        call[1] === 'user_acquisition' &&
        call[2] === 'first_touched_at'
    )
  );
});

test('author referral-lite endpoint requires authentication', async () => {
  const handler = createAuthorShareAttributionHandler({
    supabase: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) }
    }
  });
  const res = response();
  await handler({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('public X sharing remains available and carries work attribution', async () => {
  const source = await readFile(
    new URL('../novelight-public-share.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /Xでシェア/u);
  assert.match(source, /https:\/\/twitter\.com\/intent\/tweet/u);
  assert.match(source, /novelight_work_share/u);
  assert.match(source, /utm_source/u);
  assert.match(source, /utm_medium/u);
  assert.match(source, /utm_campaign/u);
  assert.match(source, /utm_content/u);
  assert.match(source, /novel:\$\{String\(novelId\)\}/u);
});

test('LIGHT ANALYTICS exposes only the lightweight private share summary UI', async () => {
  const html = await readFile(
    new URL('../analytics.html', import.meta.url),
    'utf8'
  );
  assert.match(html, /作品共有の成果/u);
  assert.match(html, /共有経由の訪問/u);
  assert.match(html, /共有経由の登録/u);
  assert.match(html, /novelight-share-attribution-lite\.js/u);
  assert.doesNotMatch(html, /紹介ランキング/u);
  assert.doesNotMatch(html, /紹介ポイント/u);
});
