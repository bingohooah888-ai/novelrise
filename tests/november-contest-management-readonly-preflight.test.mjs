import assert from 'node:assert/strict';
import test from 'node:test';
import { runManagementReadOnlyProbe } from '../scripts/november-contest-management-readonly-preflight.mjs';

const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY: 'bingohooah888-ai/novelrise',
  NOVELIGHT_CONTEST_READONLY_PREFLIGHT: 'MANUAL_READONLY_ONLY',
  SUPABASE_ACCESS_TOKEN: 'sensitive-test-token'
};
const row = {
  status: 'draft',
  public_visible: false,
  terms_version: '',
  terms_url: '',
  entry_count: 0
};

test('read-only probe uses the strictly read-only endpoint and fixed SELECT', async () => {
  let writes = 0;
  let text = '';
  const result = await runManagementReadOnlyProbe({
    env,
    request: async (url, opts) => {
      assert.match(url, /\/database\/query\/read-only$/);
      assert.equal(opts.method, 'POST');
      assert.equal(opts.redirect, 'error');
      assert.equal(opts.headers.Authorization, 'Bearer sensitive-test-token');
      const sql = JSON.parse(opts.body).query;
      assert.match(sql, /^select /i);
      assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|do)\b/i);
      writes += 0;
      return { status: 201, json: async () => [row] };
    },
    report: (line) => { text = line; }
  });
  assert.equal(result, true);
  assert.equal(writes, 0);
  assert.match(text, /STEP05_READONLY_PREFLIGHT_OK/);
  assert.doesNotMatch(text, /sensitive-test-token/);
});

test('read-only probe blocks unknown JSON response shape', async () => {
  await assert.rejects(runManagementReadOnlyProbe({
    env,
    request: async () => ({
      status: 201,
      json: async () => ({ data: [row] })
    }),
    report: () => {}
  }), /not Array<Row>/);
});

test('read-only probe blocks a non-private Production state', async () => {
  await assert.rejects(runManagementReadOnlyProbe({
    env,
    request: async () => ({
      status: 201,
      json: async () => [{ ...row, public_visible: true }]
    }),
    report: () => {}
  }), /not a private empty draft/);
});

test('read-only probe blocks failed authentication without logging response', async () => {
  await assert.rejects(runManagementReadOnlyProbe({
    env,
    request: async () => ({ status: 403, json: async () => { throw Error('must not read'); } }),
    report: () => {}
  }), /HTTP 403/);
});

test('read-only probe rejects non-manual and non-main workflows before fetching', async () => {
  let calls = 0;
  await assert.rejects(runManagementReadOnlyProbe({
    env: { ...env, GITHUB_EVENT_NAME: 'issue_comment' },
    request: async () => { calls++; throw Error('fetch must not run'); },
    report: () => {}
  }), /execution identity mismatch/);
  assert.equal(calls, 0);
});
