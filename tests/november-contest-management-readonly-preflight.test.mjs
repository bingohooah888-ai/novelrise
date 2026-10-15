import assert from 'node:assert/strict';
import test from 'node:test';

import { runManagementReadOnlyProbe } from '../scripts/november-contest-management-readonly-preflight.mjs';

const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_ACTOR: 'bingohooah888-ai',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY: 'bingohooah888-ai/novelrise',
  NOVELIGHT_CONTEST_READONLY_PREFLIGHT: 'OWNER_READONLY_ONLY',
  SUPABASE_ACCESS_TOKEN: 'sensitive-test-token'
};
const row = {
  status: 'draft',
  public_visible: false,
  terms_version: '',
  terms_url: '',
  entry_count: 0
};

test('read-only probe uses the fixed SELECT endpoint', async () => {
  let output = '';
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
      return { status: 201, json: async () => [row] };
    },
    report: (line) => {
      output = line;
    }
  });
  assert.equal(result, true);
  assert.match(output, /STEP05_READONLY_PREFLIGHT_OK/);
  assert.doesNotMatch(output, /sensitive-test-token/);
});

test('read-only probe blocks unexpected JSON shape', async () => {
  await assert.rejects(
    runManagementReadOnlyProbe({
      env,
      request: async () => ({
        status: 201,
        json: async () => ({ data: [row] })
      }),
      report: () => {}
    }),
    /not Array<Row>/
  );
});

test('read-only probe blocks non-private Production state', async () => {
  await assert.rejects(
    runManagementReadOnlyProbe({
      env,
      request: async () => ({
        status: 201,
        json: async () => [{ ...row, public_visible: true }]
      }),
      report: () => {}
    }),
    /not a private empty draft/
  );
});

test('read-only probe blocks failed authorization', async () => {
  await assert.rejects(
    runManagementReadOnlyProbe({
      env,
      request: async () => ({
        status: 403,
        json: async () => {
          throw Error('must not read');
        }
      }),
      report: () => {}
    }),
    /HTTP 403/
  );
});

test('read-only probe rejects issue events without verified owner evidence', async () => {
  let calls = 0;
  await assert.rejects(
    runManagementReadOnlyProbe({
      env: { ...env, GITHUB_EVENT_NAME: 'issue_comment' },
      request: async () => {
        calls++;
        throw Error('fetch must not run');
      },
      report: () => {}
    }),
    /owner issue event validation failed/
  );
  assert.equal(calls, 0);
});

const ownerEvent = {
  issue: { number: 2120 },
  comment: {
    user: { login: 'bingohooah888-ai' },
    author_association: 'OWNER',
    body: 'NOVELIGHT_CONTEST_READONLY_PREFLIGHT_RUN'
  }
};

const ownerEnv = {
  ...env,
  GITHUB_EVENT_NAME: 'issue_comment',
  GITHUB_EVENT_PATH: 'test-event.json'
};

test('exact issue 2120 owner comment can invoke only the fixed SELECT', async () => {
  let sqlCount = 0;
  const passed = await runManagementReadOnlyProbe({
    env: ownerEnv,
    readEvent: async () => ownerEvent,
    request: async (url, opts) => {
      sqlCount++;
      assert.match(url, /\/database\/query\/read-only$/);
      assert.match(JSON.parse(opts.body).query, /^select /i);
      return { status: 201, json: async () => [row] };
    },
    report: () => {}
  });
  assert.equal(passed, true);
  assert.equal(sqlCount, 1);
});

test('issue trigger rejects forged owner, wrong issue, edited request and PR comment', async () => {
  const invalidEvents = [
    {
      ...ownerEvent,
      comment: { ...ownerEvent.comment, user: { login: 'outsider' } }
    },
    {
      ...ownerEvent,
      comment: { ...ownerEvent.comment, author_association: 'NONE' }
    },
    {
      ...ownerEvent,
      comment: {
        ...ownerEvent.comment,
        body: 'NOVELIGHT_CONTEST_READONLY_PREFLIGHT_RUN extra'
      }
    },
    { ...ownerEvent, issue: { number: 188 } },
    { ...ownerEvent, issue: { number: 2120, pull_request: { url: 'pr' } } }
  ];
  for (const event of invalidEvents) {
    let fetchCount = 0;
    await assert.rejects(
      runManagementReadOnlyProbe({
        env: ownerEnv,
        readEvent: async () => event,
        request: async () => {
          fetchCount++;
          return { status: 201, json: async () => [row] };
        },
        report: () => {}
      }),
      /invalid owner issue request/
    );
    assert.equal(fetchCount, 0);
  }
});

test('owner issue comment still fails closed on insufficient actor', async () => {
  let fetchCount = 0;
  await assert.rejects(
    runManagementReadOnlyProbe({
      env: { ...ownerEnv, GITHUB_ACTOR: 'outsider' },
      readEvent: async () => ownerEvent,
      request: async () => {
          fetchCount++;
          return { status: 201, json: async () => [row] };
        },
      report: () => {}
    }),
    /execution identity mismatch/
  );
  assert.equal(fetchCount, 0);
});
