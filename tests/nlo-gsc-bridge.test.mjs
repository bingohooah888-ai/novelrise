import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acquireReadOnlyGscToken,
  runGscReadOnlyBridgeAction
} from '../tools/novelight-commander/src/gsc-readonly-bridge.js';

const ENV = { NLO_GSC_BRIDGE_READONLY_ENABLED: 'true' };
const fakeResult = {
  status: 'ok',
  indexStatus: 'indexed',
  verdict: 'PASS',
  coverageState: 'Submitted and indexed',
  lastCrawlTime: '2026-10-11T12:00:00Z',
  googleCanonical: 'https://novelight.jp/',
  userCanonical: 'https://novelight.jp/',
  robotsTxtState: 'ALLOWED',
  indexingState: 'INDEXING_ALLOWED',
  pageFetchState: 'SUCCESSFUL'
};

test('Bridge denies requests until locally enabled', async () => {
  let called = false;
  await assert.rejects(
    runGscReadOnlyBridgeAction({
      args: {},
      env: {},
      tokenProvider: async () => {
        called = true;
        return 'token';
      }
    }),
    (error) => error.code === 'gsc_bridge_not_authorized'
  );
  assert.equal(called, false);
});

test('Bridge rejects arbitrary URLs and commands', async () => {
  for (const args of [
    { url: 'https://example.com/' },
    { command: 'sh' },
    { siteUrl: 'sc-domain:other.example' },
    null,
    []
  ]) {
    await assert.rejects(
      runGscReadOnlyBridgeAction({
        args,
        env: ENV,
        tokenProvider: async () => 'token'
      }),
      (error) => error.code === 'gsc_args_must_be_empty'
    );
  }
});

test('Bridge uses the exact NOVELIGHT property and homepage', async () => {
  const rawToken = 'SENSITIVE_IN_MEMORY_TOKEN';
  const payload = await runGscReadOnlyBridgeAction({
    args: {},
    env: ENV,
    tokenProvider: async () => rawToken,
    listSites: async ({ token }) => {
      assert.equal(token, rawToken);
      return {
        properties: [
          { siteUrl: 'https://example.com/' },
          { siteUrl: 'https://novelight.jp/' },
          { siteUrl: 'sc-domain:novelight.jp' }
        ]
      };
    },
    inspect: async (args) => {
      assert.deepEqual(args, {
        token: rawToken,
        siteUrl: 'sc-domain:novelight.jp',
        inspectionUrl: 'https://novelight.jp/'
      });
      return fakeResult;
    }
  });
  assert.equal(JSON.parse(payload).indexStatus, 'indexed');
  assert.equal(JSON.parse(payload).coverageState, 'Submitted and indexed');
  assert.equal(payload.includes(rawToken), false);
});

test('Bridge rejects unrelated Search Console properties', async () => {
  await assert.rejects(
    runGscReadOnlyBridgeAction({
      args: {},
      env: ENV,
      tokenProvider: async () => 'SENSITIVE_IN_MEMORY_TOKEN',
      listSites: async () => ({
        properties: [{ siteUrl: 'https://other.test/' }]
      })
    }),
    (error) => error.code === 'gsc_property_access_required'
  );
});

test('Bridge never leaks raw Google errors or tokens', async () => {
  const secret = 'VERY_SENSITIVE_TOKEN';
  await assert.rejects(
    runGscReadOnlyBridgeAction({
      args: {},
      env: ENV,
      tokenProvider: async () => secret,
      listSites: async () => {
        throw new Error('Google error includes ' + secret);
      }
    }),
    (error) =>
      error.code === 'gsc_readonly_request_failed' &&
      !error.message.includes(secret)
  );
});

test('Local provider uses fixed gcloud arguments', async () => {
  const token = 'abcde0123456789abcdef012345';
  const calls = [];
  for (const platform of ['win32', 'linux']) {
    const actual = await acquireReadOnlyGscToken({
      env: {},
      platform,
      runner: async (command, args, options) => {
        calls.push({ platform, command, args, options });
        return { stdout: token + '\n' };
      }
    });
    assert.equal(actual, token);
  }
  const windows = [
    '/d',
    '/s',
    '/c',
    'gcloud.cmd',
    'auth',
    'application-default',
    'print-access-token'
  ];
  const linux = ['auth', 'application-default', 'print-access-token'];
  assert.deepEqual(calls[0].args, windows);
  assert.deepEqual(calls[1].args, linux);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[1].options.maxBuffer, 8192);
});

test('gcloud errors do not leak tokens', async () => {
  const secret = 'very-private';
  await assert.rejects(
    acquireReadOnlyGscToken({
      env: {},
      runner: async () => {
        throw new Error(secret);
      }
    }),
    (error) =>
      error.code === 'google_local_authorization_required' &&
      !String(error).includes(secret)
  );
});
