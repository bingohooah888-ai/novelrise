import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import {
  NloSupabaseStagingError,
  runNloSupabaseStagingAction
} from '../tools/novelight-commander/src/supabase-staging-action-logs.js';

const REF = 'wmlzjgvxgoyrovdhbqbg';
const BRANCH = '4ea5dd93-4032-4d53-8b4f-46bef5cb50d2';
const RUN = 'run_01hq3q9m7y5q7e4a7x2c8m1p4n';
const TOKEN = 'existing_management_access_token_offline_synthetic_only';
const ENV = {
  NLO_SUPABASE_STAGING_READONLY_ENABLED: 'true',
  NLO_SUPABASE_STAGING_PROJECT_REF: REF,
  SUPABASE_ACCESS_TOKEN: TOKEN
};
const OTHER_BRANCH = 'a6470780-fdae-40ab-965d-c2ae885af7a6';
const OTHER_RUN = 'run_other_production';
function action(branchId = BRANCH, id = RUN) {
  return {
    id,
    branch_id: branchId,
    created_at: '2026-08-25T05:59:54Z',
    updated_at: '2026-08-25T06:41:43Z',
    workdir: 'contains/secret/path',
    git_config: { credentials: TOKEN },
    run_steps: [
      { name: 'clone', status: 'EXITED', updated_at: '2026-08-25T05:59:55Z' },
      {
        name: 'migrate',
        status: 'DEAD',
        updated_at: '2026-08-25T06:41:43Z',
        error: 'sensitive SQL and body'
      }
    ]
  };
}
function fake({
  list = [action(), action(OTHER_BRANCH, OTHER_RUN)],
  logs = `SQLSTATE 42501: permission denied for secret.email@example.com
ERROR: Migration 20261110080421 failed: Remote migration versions not found in local migrations directory.
API KEY: ${TOKEN}
Authorization: Bearer ${TOKEN}
secret_key sk-super-secret
`,
  listStatus = 200,
  logStatus = 200,
  contentLength = null
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const isLog = new URL(url).pathname.endsWith('/logs');
    const status = isLog ? logStatus : listStatus;
    const text = isLog ? logs : JSON.stringify(list);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name) => (name === 'content-length' ? contentLength : null)
      },
      text: async () => text
    };
  };
  return { calls, fetchImpl };
}

test('absent opt-in, missing Management API token or wrong branch identity blocks before GET', async () => {
  const f = fake();
  const bad = [
    {},
    { ...ENV, NLO_SUPABASE_STAGING_READONLY_ENABLED: 'false' },
    { ...ENV, NLO_SUPABASE_STAGING_PROJECT_REF: 'fiepaguycecrredwrcwx' },
    { ...ENV, NLO_SUPABASE_STAGING_PROJECT_REF: 'random' },
    { ...ENV, SUPABASE_ACCESS_TOKEN: '' },
    { ...ENV, SUPABASE_ACCESS_TOKEN: 'sk-test\nleak' },
    { ...ENV, SUPABASE_ACCESS_TOKEN: 'sb_secret_not_valid_management_key' },
    {
      ...ENV,
      SUPABASE_ACCESS_TOKEN:
        'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature'
    }
  ];
  for (const env of bad) {
    await assert.rejects(
      () =>
        runNloSupabaseStagingAction({
          action: 'supabase_staging_actions',
          args: {},
          env,
          fetchImpl: f.fetchImpl
        }),
      (e) => e instanceof NloSupabaseStagingError && !String(e).includes(TOKEN)
    );
  }
  assert.equal(f.calls.length, 0);
});

test('Staging list strictly limits host/method/ref, validates branch UUID and hides parent data', async () => {
  const f = fake();
  const data = await runNloSupabaseStagingAction({
    action: 'supabase_staging_actions',
    env: ENV,
    fetchImpl: f.fetchImpl
  });
  assert.equal(data.projectRef, REF);
  assert.equal(data.returned, 1);
  assert.equal(data.runs[0].runId, RUN);
  assert.equal(data.runs[0].failed, true);
  assert.equal(data.runs[0].steps[1].name, 'migrate');
  assert.deepEqual(
    data.runs[0].steps.map((s) => s.status),
    ['EXITED', 'DEAD']
  );
  assert.equal(f.calls.length, 1);
  const c = f.calls[0];
  const u = new URL(c.url);
  assert.equal(u.origin, 'https://api.supabase.com');
  assert.equal(u.pathname, '/v1/projects/' + REF + '/actions');
  assert.equal(u.searchParams.get('limit'), '25');
  assert.equal(c.init.method, 'GET');
  assert.equal(c.init.redirect, 'error');
  assert.equal(c.init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(c.init.body, undefined);
  const serialized = JSON.stringify(data);
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes(OTHER_RUN), false);
  assert.equal(serialized.includes('secret/path'), false);
  assert.equal(serialized.includes('fiepaguycecrredwrcwx'), false);
});

test('log diagnosis confirms staging run membership before the next GET and reveals only fixed signals', async () => {
  const f = fake();
  const value = await runNloSupabaseStagingAction({
    action: 'supabase_staging_action_logs',
    args: { runId: RUN },
    env: ENV,
    fetchImpl: f.fetchImpl
  });
  assert.equal(f.calls.length, 2);
  assert.equal(
    new URL(f.calls[1].url).pathname,
    '/v1/projects/' + REF + '/actions/' + RUN + '/logs'
  );
  assert.deepEqual(value.categories, [
    'migration_history_divergence',
    'migration_step_failed',
    'permission_denied'
  ]);
  assert.deepEqual(value.sqlstates, ['42501']);
  assert.deepEqual(value.migrationVersions, ['20261110080421']);
  assert.equal(value.rawLogsReturned, false);
  const s = JSON.stringify(value);
  for (const secret of [
    TOKEN,
    'secret.email@example.com',
    'sk-super-secret',
    'Bearer',
    'SQLSTATE 42501:',
    'secret_key'
  ]) {
    assert.equal(s.includes(secret), false, secret);
  }
});

test('an arbitrary production run or invalid path never causes a log GET', async () => {
  const f = fake();
  for (const value of [
    OTHER_RUN,
    '../../etc/passwd',
    'r',
    RUN + '?ref=fiepaguycecrredwrcwx'
  ]) {
    await assert.rejects(
      () =>
        runNloSupabaseStagingAction({
          action: 'supabase_staging_action_logs',
          args: { runId: value },
          env: ENV,
          fetchImpl: f.fetchImpl
        }),
      (e) => e instanceof NloSupabaseStagingError
    );
  }
  assert.ok(f.calls.every((c) => !new URL(c.url).pathname.endsWith('/logs')));
});

test('cross-branch responses and malformed provenance refuse diagnostic evidence', async () => {
  const scenarios = [
    [action(OTHER_BRANCH, OTHER_RUN)],
    [{ ...action(), branch_id: null }],
    [{ ...action(), id: '../attack' }],
    [{ ...action(), run_steps: [{ name: 'unknown', status: 'DEAD' }] }],
    [{ ...action(), run_steps: [{ name: 'migrate', status: 'USER_SECRET' }] }],
    [action(), action()]
  ];
  for (const list of scenarios) {
    const f = fake({ list });
    if (list.length === 1 && list[0]?.branch_id === OTHER_BRANCH) {
      const x = await runNloSupabaseStagingAction({
        action: 'supabase_staging_actions',
        env: ENV,
        fetchImpl: f.fetchImpl
      });
      assert.equal(x.returned, 0);
      continue;
    }
    if (list.length === 1 && list[0]?.branch_id === null) {
      const x = await runNloSupabaseStagingAction({
        action: 'supabase_staging_actions',
        env: ENV,
        fetchImpl: f.fetchImpl
      });
      assert.equal(x.returned, 0);
      continue;
    }
    await assert.rejects(
      () =>
        runNloSupabaseStagingAction({
          action: 'supabase_staging_actions',
          env: ENV,
          fetchImpl: f.fetchImpl
        }),
      (e) => e instanceof NloSupabaseStagingError
    );
  }
});

test('401/403 fail with capability error, 429 and 500 do not retry or echo response', async () => {
  for (const status of [401, 403, 429, 500]) {
    const f = fake({ listStatus: status });
    await assert.rejects(
      () =>
        runNloSupabaseStagingAction({
          action: 'supabase_staging_actions',
          env: ENV,
          fetchImpl: f.fetchImpl
        }),
      (e) =>
        e instanceof NloSupabaseStagingError &&
        e.code ===
          (status === 429
            ? 'nlo_sb_rate_limited'
            : status === 401 || status === 403
              ? 'nlo_sb_insufficient_management_permission'
              : 'nlo_sb_management_api_unavailable')
    );
    assert.equal(f.calls.length, 1);
  }
  const log = fake({ logStatus: 403 });
  await assert.rejects(
    () =>
      runNloSupabaseStagingAction({
        action: 'supabase_staging_action_logs',
        args: { runId: RUN },
        env: ENV,
        fetchImpl: log.fetchImpl
      }),
    (e) => e.code === 'nlo_sb_insufficient_management_permission'
  );
  assert.equal(log.calls.length, 2);
});

test('invalid JSON, oversized response and injected input fail without leaking provider data', async () => {
  const over = fake({ contentLength: '999999' });
  await assert.rejects(
    () =>
      runNloSupabaseStagingAction({
        action: 'supabase_staging_actions',
        env: ENV,
        fetchImpl: over.fetchImpl
      }),
    (e) => e.code === 'nlo_sb_response_too_large'
  );
  const malformed = fake({ list: '{bad json' });
  await assert.rejects(
    () =>
      runNloSupabaseStagingAction({
        action: 'supabase_staging_actions',
        env: ENV,
        fetchImpl: malformed.fetchImpl
      }),
    (e) => e.code === 'nlo_sb_unexpected_action_shape'
  );
  const f = fake();
  for (const args of [
    { url: 'https://example.com' },
    { token: TOKEN },
    { runId: RUN, other: true }
  ]) {
    await assert.rejects(
      () =>
        runNloSupabaseStagingAction({
          action: 'supabase_staging_action_logs',
          args,
          env: ENV,
          fetchImpl: f.fetchImpl
        }),
      (e) => e instanceof NloSupabaseStagingError
    );
  }
  await assert.rejects(
    () =>
      runNloSupabaseStagingAction({
        action: 'supabase_staging_mutate',
        args: {},
        env: ENV,
        fetchImpl: f.fetchImpl
      }),
    (e) => e.code === 'nlo_sb_action_denied'
  );
  assert.equal(f.calls.length, 0);
});

test('the direct MCP and owner bridge both expose only the same vetted read-only actions', () => {
  const idx = readFileSync(
    new URL('../tools/novelight-commander/src/index.js', import.meta.url),
    'utf8'
  );
  const bridge = readFileSync(
    new URL(
      '../tools/novelight-commander/src/github-bridge-core.js',
      import.meta.url
    ),
    'utf8'
  );
  const env = readFileSync(
    new URL('../tools/novelight-commander/.env.example', import.meta.url),
    'utf8'
  );
  const reg = JSON.parse(
    readFileSync(
      new URL('../.novelight/nlo-capabilities.json', import.meta.url),
      'utf8'
    )
  );
  for (const name of [
    'supabase_staging_actions',
    'supabase_staging_action_logs'
  ]) {
    assert.ok(idx.includes('register("' + name + '"'), name);
    assert.ok(
      bridge.includes("['" + name + "', actionSupabaseStagingNloReadOnly]"),
      name
    );
  }
  assert.match(env, /NLO_SUPABASE_STAGING_READONLY_ENABLED=false/);
  assert.ok(!env.includes('SUPABASE_ACCESS_TOKEN='));
  const item = reg.capabilities.find(
    (c) => c.id === 'nlo.supabase.staging-action-logs-readonly'
  );
  assert.equal(item.status, 'testing');
  assert.equal(item.executionRisk, 'C');
});
