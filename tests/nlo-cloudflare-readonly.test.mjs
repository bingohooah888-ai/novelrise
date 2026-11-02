// prettier-ignore
import assert from 'node:assert/strict';
// prettier-ignore
import {readFile} from 'node:fs/promises';
// prettier-ignore
import test from 'node:test';
// prettier-ignore
import {createNloCloudflareReadOnly, NloCloudflareError,
  runNloCloudflareAction} from '../tools/novelight-commander/src/cloudflare-readonly.js';

// prettier-ignore
const ACCOUNT = '6831b18fe814232fa2dd4c470b95aa15';
// prettier-ignore
const TOKEN = 'LOCAL_SECRET_CLOUDFLARE_TOKEN_KEEP_PRIVATE';
// prettier-ignore
const ENV = {NLO_CLOUDFLARE_READONLY_ENABLED: 'true',
  NLO_CLOUDFLARE_ACCOUNT_ID: ACCOUNT, NLO_CLOUDFLARE_READ_TOKEN: TOKEN};
// prettier-ignore
const NAME = 'novelight-ai-gatea-watchdog';
// prettier-ignore
const NS = 'd'.repeat(32);
// prettier-ignore
function fake({fail = false, graphqlError = false} = {}) {
  const calls = [];
  async function fetchImpl(url, opts) {
    calls.push({url, method: opts.method, opts});
    const p = new URL(url).pathname;
    if (fail) return {ok: false, status: 403};
    let body;
    if (p.endsWith('/graphql')) body = graphqlError
      ? {errors: [{message: TOKEN}]}
      : {data: {viewer: {accounts: [{workersInvocationsAdaptive: [
        {sum: {requests: 18, errors: 2}},
        {sum: {requests: 2, errors: 0}}
      ]}]}}};
    else if (p.endsWith('/workers/scripts')) body = {success: true, result: [
      {id: NAME, modified_on: '2026-11-02T00:00:00Z'},
      {id: 'unrelated-worker', modified_on: '2026-11-02T00:00:00Z'}
    ]};
    else if (p.endsWith('/deployments')) body = {success: true, result: {
      deployments: [{id: 'fake-version', source: 'api', created_on: '2026-11-02T00:00:00Z'}]
    }};
    else if (p.endsWith('/script-settings')) body = {success: true, result: {
      logpush: false, observability: {
        enabled: true, logs: {enabled: true, invocation_logs: true},
        traces: {enabled: false}, secrets: {SHOULD_NEVER_LEAK: TOKEN}
      }
    }};
    else if (p.endsWith('/durable_objects/namespaces')) body = {success: true, result: [
      {id: NS, name: 'novelight-ai-gatea-state', script: NAME},
      {id: 'e'.repeat(32), name: 'unrelated', script: 'other'}
    ]};
    else if (p.endsWith('/objects')) body = {success: true, result: [
      {id: 'sensitive-object-identifier', secret: TOKEN}
    ]};
    else body = {success: true, result: {id: ACCOUNT, type: 'standard',
      name: 'Private Customer Account', email: TOKEN}};
    return {ok: true, status: 200, json: async () => body};
  }
  return {fetchImpl, calls};
}

// prettier-ignore
test('absent local opt-in and token deny before any network request', async () => {
  const network = fake();
  for (const env of [{}, {...ENV, NLO_CLOUDFLARE_READONLY_ENABLED: 'false'},
    {...ENV, NLO_CLOUDFLARE_ACCOUNT_ID: '0'.repeat(32)},
    {...ENV, NLO_CLOUDFLARE_READ_TOKEN: ''}]) {
    await assert.rejects(() => runNloCloudflareAction({
      action: 'cloudflare_account', args: {}, env, fetchImpl: network.fetchImpl
    }), (e) => e instanceof NloCloudflareError);
  }
  assert.equal(network.calls.length, 0);
});

// prettier-ignore
test('account and list operations emit only scoped allowlisted metadata', async () => {
  const net = fake();
  const client = createNloCloudflareReadOnly({env: ENV, fetchImpl: net.fetchImpl});
  const account = await client.account();
  const workers = await client.workers();
  const namespaces = await client.namespaces();
  assert.equal(account.accountId, ACCOUNT);
  assert.equal(account.accountType, 'standard');
  assert.equal(account.plan, 'not_available_from_account_details_api');
  assert.deepEqual(workers.scripts.map((x) => x.name), [NAME]);
  assert.deepEqual(namespaces.namespaces.map((x) => x.id), [NS]);
  assert.equal(JSON.stringify({account, workers, namespaces}).includes(TOKEN), false);
  assert.equal(JSON.stringify({account, workers, namespaces}).includes('unrelated'), false);
  assert.ok(net.calls.every((c) => c.opts.redirect === 'error'));
  assert.ok(net.calls.every((c) => c.opts.headers.Authorization === 'Bearer ' + TOKEN));
});

// prettier-ignore
test('deployments and observability never expose scripts, bindings, token or raw logs', async () => {
  const net = fake();
  const deployments = await runNloCloudflareAction({action: 'cloudflare_worker_deployments',
    args: {workerName: NAME}, env: ENV, fetchImpl: net.fetchImpl});
  const logs = await runNloCloudflareAction({action: 'cloudflare_worker_observability',
    args: {workerName: NAME}, env: ENV, fetchImpl: net.fetchImpl});
  assert.equal(deployments.deployments.length, 1);
  assert.equal(logs.logsEnabled, true);
  assert.equal(logs.rawLogsReturned, false);
  assert.equal(JSON.stringify({deployments, logs}).includes(TOKEN), false);
});

// prettier-ignore
test('GraphQL metrics are static scoped read-only query with numeric aggregates', async () => {
  const net = fake();
  const result = await runNloCloudflareAction({action: 'cloudflare_worker_metrics',
    args: {workerName: NAME, minutes: 60}, env: ENV, now: () => 1793577600000,
    fetchImpl: net.fetchImpl});
  assert.equal(result.requests, 20);
  assert.equal(result.errors, 2);
  assert.equal(result.errorRate, 0.1);
  assert.equal(result.rawLogsReturned, false);
  const gql = net.calls.find((c) => c.method === 'POST');
  assert.ok(gql);
  assert.equal(new URL(gql.url).pathname, '/client/v4/graphql');
  const payload = JSON.parse(gql.opts.body);
  assert.equal(payload.variables.scriptName, NAME);
  assert.equal(payload.variables.accountTag, ACCOUNT);
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

// prettier-ignore
test('DO count hides object identifiers and refuses any unowned namespace', async () => {
  const net = fake();
  const value = await runNloCloudflareAction({action: 'cloudflare_do_object_count',
    args: {namespaceId: NS}, env: ENV, fetchImpl: net.fetchImpl});
  assert.equal(value.countReturned, 1);
  assert.equal(JSON.stringify(value).includes('sensitive-object-identifier'), false);
  const before = net.calls.length;
  await assert.rejects(() => runNloCloudflareAction({
    action: 'cloudflare_do_object_count', args: {namespaceId: 'c'.repeat(32)},
    env: ENV, fetchImpl: net.fetchImpl
  }), (e) => e.code === 'nlo_cf_namespace_not_owned_by_gatea');
  assert.equal(net.calls.length, before + 1); // only namespace inventory read
});

// prettier-ignore
test('invalid args, unrelated workers and token-injection are rejected with no requests', async () => {
  const net = fake();
  const inputs = [
    ['cloudflare_account', {secret: TOKEN}],
    ['cloudflare_workers', {url: 'https://example.com'}],
    ['cloudflare_worker_deployments', {workerName: 'other'}],
    ['cloudflare_worker_metrics', {workerName: NAME, minutes: 1441}],
    ['cloudflare_worker_observability', {workerName: NAME + '/x'}],
    ['cloudflare_plan_change', {action: 'delete_worker', workerName: 'unrelated'}],
    ['cloudflare_undeclared_mutation', {}]
  ];
  for (const [action, args] of inputs) {
    await assert.rejects(() => runNloCloudflareAction({
      action, args, env: ENV, fetchImpl: net.fetchImpl
    }), (e) => e instanceof NloCloudflareError);
  }
  assert.equal(net.calls.length, 0);
});

// prettier-ignore
test('provider failures and GraphQL errors are sanitized, never echo secrets', async () => {
  for (const net of [fake({fail: true}), fake({graphqlError: true})]) {
    const action = net === null ? 'cloudflare_account' : 'cloudflare_worker_metrics';
    await assert.rejects(() => runNloCloudflareAction({
      action, args: {workerName: NAME, minutes: 60},
      env: ENV, fetchImpl: net.fetchImpl
    }), (e) => e instanceof NloCloudflareError &&
      !String(e).includes(TOKEN));
  }
});

// prettier-ignore
test('Watchdog status is NO-GO until external controller and zero-census verified', async () => {
  const net = fake();
  const status = await runNloCloudflareAction({
    action: 'cloudflare_watchdog_status', args: {}, env: ENV, fetchImpl: net.fetchImpl
  });
  assert.equal(status.watchdogScriptFound, true);
  assert.equal(status.gateA, 'NO_GO');
  assert.equal(status.liveRecoveryAuthorized, false);
  assert.equal(status.runnerKillAuthority, 'NOT_VERIFIED');
});

// prettier-ignore
test('mutation actions create non-executable plans without token or network', async () => {
  const net = fake();
  const plan = await runNloCloudflareAction({
    action: 'cloudflare_plan_change', args: {
      action: 'create_worker', workerName: NAME
    }, env: {}, fetchImpl: net.fetchImpl
  });
  assert.equal(plan.effect, 'none');
  assert.equal(plan.liveAuthorization, false);
  assert.equal(net.calls.length, 0);
});

// prettier-ignore
test('direct NLO MCP, GitHub Bridge and capability registry all reference Cloudflare integration', async () => {
  const [direct, bridge, registry] = await Promise.all([
    readFile(new URL('../tools/novelight-commander/src/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../tools/novelight-commander/src/github-bridge-core.js', import.meta.url), 'utf8'),
    readFile(new URL('../.novelight/nlo-capabilities.json', import.meta.url), 'utf8')
  ]);
  for (const action of ['cloudflare_account', 'cloudflare_workers',
    'cloudflare_durable_objects', 'cloudflare_worker_metrics',
    'cloudflare_worker_observability', 'cloudflare_plan_change',
    'cloudflare_watchdog_status']) {
    assert.ok(direct.includes(action), 'direct ' + action);
    assert.ok(bridge.includes(action), 'bridge ' + action);
  }
  assert.ok(registry.includes('nlo.cloudflare.gatea-readonly'));
});
