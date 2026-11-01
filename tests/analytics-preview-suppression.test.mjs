import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const runtime = readFileSync(new URL('../novelight-client.js', import.meta.url), 'utf8');

function sourceBetween(start, end) {
  const a = runtime.indexOf(start);
  const b = runtime.indexOf(end, a);
  assert.ok(a !== -1 && b > a, 'expected runtime function boundaries');
  return runtime.slice(a, b);
}

const hostSource = sourceBetween('  function isVercelPreviewHost() {', '  function validateStagingBrowserConfig(');
const analyticsSource = sourceBetween('  async function analyticsEvent(client, payload) {', '  async function recordVisit(');
const acquisitionSource = sourceBetween('  async function captureAcquisition(client) {', '  function storedSource() {');

function isPreviewFor(hostname) {
  const scope = { location: { hostname } };
  return new Function('window', hostSource + '; return isVercelPreviewHost();')(scope);
}

function analyticsFixture(hostname) {
  let requests = 0;
  let sessionReads = 0;
  const send = async (_url, opts) => {
    requests++;
    return { ok: true, json: async () => ({ accepted: true, options: opts }) };
  };
  const client = {
    auth: {
      async getSession() {
        sessionReads++;
        return { data: { session: null } };
      }
    }
  };
  const analytics = new Function(
    'isVercelPreviewHost',
    'fetch',
    'console',
    analyticsSource + '; return analyticsEvent;'
  )(() => isPreviewFor(hostname), send, console);
  return { client, analytics, get requests() { return requests; }, get sessionReads() { return sessionReads; } };
}

test('a Preview never POSTs analytics or reads auth tokens for telemetry', async () => {
  const f = analyticsFixture('novelrise-pr-123-ranobe1.vercel.app');
  assert.deepEqual(await f.analytics(f.client, { action: 'visit' }), {
    accepted: false,
    recorded_count: 0,
    disabled: 'preview'
  });
  assert.equal(f.requests, 0);
  assert.equal(f.sessionReads, 0);
});
test('Production custom domain continues to POST analytics', async () => {
  const f = analyticsFixture('novelight.jp');
  assert.equal((await f.analytics(f.client, { action: 'visit' })).accepted, true);
  assert.equal(f.requests, 1);
  assert.equal(f.sessionReads, 1);
});
test('Production alias is not treated as Preview', async () => {
  const f = analyticsFixture('novelrise.vercel.app');
  await f.analytics(f.client, { action: 'visit' });
  assert.equal(f.requests, 1);
});
test('local development remains unchanged', async () => {
  const f = analyticsFixture('localhost');
  await f.analytics(f.client, { action: 'visit' });
  assert.equal(f.requests, 1);
});
test('a Preview acquisition preserves auth header without writing fake attribution', async () => {
  let headerSynced = 0;
  let touches = 0;
  let storageWrites = 0;
  const acquisition = new Function(
    'isVercelPreviewHost',
    'syncAuthHeader',
    'currentTouch',
    'getStoredTouch',
    'safeStorageSet',
    'window',
    'TRAFFIC_KEY',
    'TOUCH_SESSION_KEY',
    'analyticsEvent',
    'console',
    acquisitionSource + '; return captureAcquisition;'
  )(
    () => true,
    () => { headerSynced++; },
    () => { touches++; return {}; },
    () => null,
    () => { storageWrites++; },
    { localStorage: {}, sessionStorage: {} },
    'test-traffic', 'test-session', async () => ({}), console
  );
  await acquisition({});
  assert.equal(headerSynced, 1);
  assert.equal(touches, 0);
  assert.equal(storageWrites, 0);
});
test('Preview suppression remains limited to the common analytics client', () => {
  assert.match(runtime, /if \(isVercelPreviewHost\(\)\) \{\s+return \{ accepted: false, recorded_count: 0, disabled: 'preview' \};/);
});
