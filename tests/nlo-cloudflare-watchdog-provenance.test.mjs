import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {URL} from 'node:url';
import test from 'node:test';
import {
  NloCloudflareError,
  runNloCloudflareAction
} from '../tools/novelight-commander/src/cloudflare-readonly.js';

const ACCOUNT = '6831b18fe814232fa2dd4c470b95aa15';
const WORKER = 'novelight-ai-gatea-watchdog';
const NS = '015ef5be967f4fbfbad31ab24a22bf26';
const DEPLOYMENT = 'c8d8c9a2-4d6f-4a28-b9b9-57eced1a1173';
const VERSION = '12345678-1234-4234-8234-123456789abc';
const EXPECTED = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const SECRET = 'HIDDEN_AUTH_TOKEN_NEVER_TO_LEAK';
const ENV = {
  NLO_CLOUDFLARE_READONLY_ENABLED: 'true',
  NLO_CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
  NLO_CLOUDFLARE_READ_TOKEN: SECRET
};

function fixture({status = 200, noBinding = false, noExport = false,
  wrongVersion = false, content = 'abc', split = false} = {}) {
  const calls = [];
  const result = (payload) => ({
    ok: true, status: 200,
    json: async () => ({success: true, result: payload})
  });
  const raw = (value) => ({
    ok: status === 200, status,
    headers: {get: (key) => key === 'content-type' ? 'text/javascript' : null},
    arrayBuffer: async () => Uint8Array.from(Buffer.from(value)).buffer
  });
  async function fetchImpl(url, opts) {
    calls.push({url, opts});
    const p = new URL(url).pathname;
    if (p.endsWith('/content/v2')) return raw(content);
    if (p.endsWith('/deployments')) return result({deployments: [
      {id: DEPLOYMENT, source: 'wrangler', created_on: '2026-11-03T10:22:44Z'}
    ]});
    if (p.endsWith('/deployments/' + DEPLOYMENT)) return result({
      id: DEPLOYMENT,
      versions: split ? [
        {version_id: VERSION, percentage: 50},
        {version_id: VERSION, percentage: 50}
      ] : [{version_id: VERSION, percentage: 100}]
    });
    if (p.endsWith('/versions/' + VERSION)) return result({
      id: wrongVersion ? 'other' : VERSION,
      resources: {script_runtime: {
        exports: noExport ? {} : {
          GateAWatchdogDurableObject: {
            type: 'durable-object', storage: 'sqlite', state: 'created'
          }
        }
      }}
    });
    if (p.endsWith('/settings')) return result({
      bindings: noBinding ? [] : [{
        name: 'GATEA_WATCHDOG', type: 'durable_object_namespace',
        class_name: 'GateAWatchdogDurableObject'
      }],
      secretData: SECRET
    });
    if (p.endsWith('/durable_objects/namespaces')) return result([{
      id: NS, script: WORKER,
      name: 'novelight-ai-gatea-watchdog_GateAWatchdogDurableObject'
    }]);
    throw Error('unexpected path: ' + p);
  }
  return {fetchImpl, calls};
}

test('exact worker raw response is hashed, never returned, and only GET is used',
  async () => {
    const net = fixture();
    const report = await runNloCloudflareAction({
      action: 'cloudflare_watchdog_provenance',
      args: {expectedContentSha256: EXPECTED},
      env: ENV, fetchImpl: net.fetchImpl
    });
    assert.equal(report.contentSha256, EXPECTED);
    assert.equal(report.contentBytes, 3);
    assert.equal(report.hashMatchesExpected, true);
    assert.equal(report.bindingVerified, true);
    assert.equal(report.sqliteClassVerified, true);
    assert.equal(report.namespaceVerified, true);
    assert.equal(report.versionId, VERSION);
    assert.equal(report.rollbackCandidateVersionId, VERSION);
    assert.equal(report.rollbackEligibility, 'NOT_VERIFIED_BY_READ_ONLY');
    assert.equal(report.gateA, 'NO_GO');
    assert.equal(report.sourceReturned, false);
    assert.equal(report.secretsReturned, false);
    assert.ok(net.calls.every(x => x.opts.method === 'GET'));
    assert.ok(net.calls.every(x => x.opts.redirect === 'error'));
    assert.equal(JSON.stringify(report).includes(SECRET), false);
    assert.equal(JSON.stringify(report).includes('abc'), false);
  });

test('no matching comparison hash is never reported as verified', async () => {
  const net = fixture();
  const result = await runNloCloudflareAction({
    action: 'cloudflare_watchdog_provenance',
    args: {}, env: ENV, fetchImpl: net.fetchImpl
  });
  assert.equal(result.hashMatchesExpected, null);
  assert.equal(result.originalA1HashesDirectlyComparable, false);
});

test('changed source hash cannot be passed as a successful identity proof',
  async () => {
    const net = fixture({content: 'different'});
    const result = await runNloCloudflareAction({
      action: 'cloudflare_watchdog_provenance',
      args: {expectedContentSha256: EXPECTED},
      env: ENV, fetchImpl: net.fetchImpl
    });
    assert.equal(result.hashMatchesExpected, false);
    assert.equal(result.gateA, 'NO_GO');
  });

test('missing binding or mismatched DO export stays NO-GO', async () => {
  for (const opts of [{noBinding: true}, {noExport: true}]) {
    const net = fixture(opts);
    const result = await runNloCloudflareAction({
      action: 'cloudflare_watchdog_provenance',
      args: {}, env: ENV, fetchImpl: net.fetchImpl
    });
    assert.equal(result.bindingVerified && result.sqliteClassVerified, false);
    assert.equal(result.gateA, 'NO_GO');
  }
});

test('split deployment, missing version and content permission deny safely',
  async () => {
    for (const opts of [
      {split: true}, {wrongVersion: true}, {status: 403}
    ]) {
      const net = fixture(opts);
      await assert.rejects(
        runNloCloudflareAction({
          action: 'cloudflare_watchdog_provenance',
          args: {}, env: ENV, fetchImpl: net.fetchImpl
        }),
        err => err instanceof NloCloudflareError &&
          !String(err).includes(SECRET)
      );
    }
  });

test('scope, false opt-in and oversized content reject', async () => {
  const net = fixture();
  for (const args of [
    {workerName: 'other'},
    {expectedContentSha256: 'not-a-sha'},
    {url: 'https://evil.example/'}
  ]) {
    await assert.rejects(
      runNloCloudflareAction({
        action: 'cloudflare_watchdog_provenance',
        args, env: ENV, fetchImpl: net.fetchImpl
      }),
      e => e instanceof NloCloudflareError
    );
  }
  assert.equal(net.calls.length, 0);
  await assert.rejects(runNloCloudflareAction({
    action: 'cloudflare_watchdog_provenance', args: {},
    env: {...ENV, NLO_CLOUDFLARE_READONLY_ENABLED: 'false'},
    fetchImpl: net.fetchImpl
  }), e => e instanceof NloCloudflareError);
  assert.equal(net.calls.length, 0);
  const big = fixture({content: 'x'.repeat(4 * 1024 * 1024 + 1)});
  await assert.rejects(runNloCloudflareAction({
    action: 'cloudflare_watchdog_provenance',
    args: {}, env: ENV, fetchImpl: big.fetchImpl
  }), e => e instanceof NloCloudflareError);
});

test('direct NLO, Bridge and registry expose only the scoped provenance action',
  async () => {
    const [direct, bridge, registry] = await Promise.all([
      readFile(new URL('../tools/novelight-commander/src/index.js', import.meta.url),
        'utf8'),
      readFile(new URL('../tools/novelight-commander/src/github-bridge-core.js', import.meta.url),
        'utf8'),
      readFile(new URL('../.novelight/nlo-capabilities.json', import.meta.url), 'utf8')
    ]);
    assert.match(direct, /cloudflare_watchdog_provenance/u);
    assert.match(bridge, /cloudflare_watchdog_provenance/u);
    assert.match(registry, /nlo.cloudflare.gatea-readonly/u);
    assert.doesNotMatch(bridge, /cloudflare_worker_source_download/u);
  });
