import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import { createSitemapHandler } from '../api/sitemap.js';

function createResponse() {
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
    send(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.body = '';
      return this;
    }
  };
}

function createSupabase(fixtures) {
  return {
    from(table) {
      let rows = [...(fixtures[table] || [])];
      return {
        select() {
          return this;
        },
        eq(column, value) {
          rows = rows.filter((row) => row[column] === value);
          return this;
        },
        order(column, { ascending } = {}) {
          rows.sort((left, right) => {
            const direction = ascending === false ? -1 : 1;
            return (
              String(left[column]).localeCompare(String(right[column])) *
              direction
            );
          });
          return this;
        },
        async range(from, to) {
          return { data: rows.slice(from, to + 1), error: null };
        }
      };
    }
  };
}

async function run(type, fixtures = {}, method = 'GET') {
  const req = { method, query: { type } };
  const res = createResponse();
  const handler = createSitemapHandler({ supabase: createSupabase(fixtures) });
  await handler(req, res);
  return res;
}

test('core sitemap contains reader-facing core pages but not operator pages', async () => {
  const res = await run('core');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /https:\/\/novelight\.jp\/search\.html/);
  assert.match(res.body, /https:\/\/novelight\.jp\/ranking\.html/);
  assert.doesNotMatch(res.body, /operator\.html/);
});

test('novel sitemap contains published novels only', async () => {
  const res = await run('novels', {
    novels: [
      { id: 10, status: 'published' },
      { id: 11, status: 'draft' }
    ]
  });
  assert.match(res.body, /novel\.html\?id=10/);
  assert.doesNotMatch(res.body, /novel\.html\?id=11/);
});

test('episode sitemap excludes episodes whose parent novel is not published', async () => {
  const res = await run('episodes', {
    novels: [
      { id: 10, user_id: 'author-a', status: 'published' },
      { id: 11, user_id: 'author-b', status: 'draft' }
    ],
    episodes: [
      { id: 100, novel_id: 10, status: 'published' },
      { id: 101, novel_id: 11, status: 'published' },
      { id: 102, novel_id: 10, status: 'draft' }
    ]
  });
  assert.match(res.body, /episode\.html\?id=100/);
  assert.doesNotMatch(res.body, /episode\.html\?id=101/);
  assert.doesNotMatch(res.body, /episode\.html\?id=102/);
});

test('author sitemap deduplicates authors with multiple published works', async () => {
  const res = await run('authors', {
    novels: [
      { id: 10, user_id: 'author-a', status: 'published' },
      { id: 11, user_id: 'author-a', status: 'published' },
      { id: 12, user_id: 'author-b', status: 'published' }
    ]
  });
  assert.equal((res.body.match(/author\.html\?id=author-a/g) || []).length, 1);
  assert.equal((res.body.match(/author\.html\?id=author-b/g) || []).length, 1);
});

test('unknown sitemap type is rejected and HEAD omits the body', async () => {
  const invalid = await run('unknown');
  assert.equal(invalid.statusCode, 400);

  const head = await run('core', {}, 'HEAD');
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, '');
});

test('sitemap index points at all segmented dynamic sitemaps', async () => {
  const xml = await readFile(
    new URL('../sitemap.xml', import.meta.url),
    'utf8'
  );
  for (const type of ['core', 'novels', 'episodes', 'authors']) {
    assert.match(xml, new RegExp(`/api/sitemap\\?type=${type}`));
  }
});
