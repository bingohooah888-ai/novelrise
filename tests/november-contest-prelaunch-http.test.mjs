import assert from 'node:assert/strict';
import test from 'node:test';

import { createContestPageHandler } from '../api/contest-page.js';
import { createContestTermsHandler } from '../api/contest-terms.js';
import {
  CONTEST_TERMS_URL_CANDIDATE,
  CONTEST_TERMS_VERSION_CANDIDATE
} from '../api/_lib/contest-terms-template.js';

const released = {
  status: 'registration',
  public_visible: true,
  terms_version: CONTEST_TERMS_VERSION_CANDIDATE,
  terms_url: CONTEST_TERMS_URL_CANDIDATE
};

const routes = [
  ['contest landing', createContestPageHandler],
  ['contest terms', createContestTermsHandler]
];

function response() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    end() {
      this.body = '';
      return this;
    }
  };
}

function database(row, { error = null, throwError = false } = {}) {
  const calls = [];
  const getDatabase = () => ({
    from(table) {
      assert.equal(table, 'novelight_contests');
      return {
        select(columns) {
          calls.push(columns);
          return this;
        },
        eq(field, value) {
          assert.equal(field, 'contest_key');
          assert.equal(value, 'novelight-november-2026');
          return this;
        },
        async maybeSingle() {
          if (throwError) throw new Error('database offline');
          return { data: row, error };
        }
      };
    }
  });
  return { getDatabase, calls };
}

for (const [name, createHandler] of routes) {
  test(`${name}: never publishes draft, disabled, or missing contest`, async () => {
    for (const row of [
      { ...released, status: 'draft' },
      { ...released, public_visible: false },
      { ...released, status: 'cancelled' },
      null
    ]) {
      const mock = database(row);
      const res = response();
      await createHandler(mock.getDatabase)({ method: 'GET' }, res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body, 'Not Found');
      assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
      assert.equal(res.headers['CDN-Cache-Control'], 'no-store');
      assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store');
      assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
      assert.equal(mock.calls.length, 1);
    }
  });

  test(`${name}: denies database errors and missing credentials`, async () => {
    for (const options of [{ error: new Error('permission denied') }, { throwError: true }]) {
      const mock = database(released, options);
      const res = response();
      await createHandler(mock.getDatabase)({ method: 'GET' }, res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
    }
    const res = response();
    await createHandler(() => {
      throw new Error('missing Supabase configuration');
    })({ method: 'GET' }, res);
    assert.equal(res.statusCode, 404);
  });

  test(`${name}: only validated release produces uncached HTML`, async () => {
    const mock = database(released);
    for (const method of ['GET', 'HEAD']) {
      const res = response();
      await createHandler(mock.getDatabase)({ method }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
      assert.equal(res.headers['CDN-Cache-Control'], 'no-store');
      assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store');
      assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
      if (method === 'GET') assert.match(res.body, /NOVELIGHT/);
      else assert.equal(res.body, '');
    }
  });

  test(`${name}: rejects non-read methods before querying DB`, async () => {
    const res = response();
    await createHandler(() => {
      throw new Error('must not query DB');
    })({ method: 'POST' }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, 'GET, HEAD');
  });
}

test('terms endpoint cannot serve a mismatched version or URL', async () => {
  for (const record of [
    { ...released, terms_version: 'stale-v0' },
    { ...released, terms_url: 'https://example.test/mismatch' },
    { ...released, terms_version: '' },
    { ...released, terms_url: '' }
  ]) {
    const mock = database(record);
    const res = response();
    await createContestTermsHandler(mock.getDatabase)({ method: 'GET' }, res);
    assert.equal(res.statusCode, 404);
  }
});
