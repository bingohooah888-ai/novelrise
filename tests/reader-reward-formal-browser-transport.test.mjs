import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, URLSearchParams } from 'node:url';
import { runInNewContext } from 'node:vm';

const UUID = '33333333-3333-4333-8333-333333333333';
function browser() {
  const context = { URLSearchParams };
  const root = new URL('../assets/', import.meta.url);
  for (const asset of [
    'formal-scout-reward-transport.js',
    'formal-scout-reward-client.js',
    'formal-scout-reward-admin.js'
  ]) {
    runInNewContext(readFileSync(new URL(asset, root), 'utf8'), context, {
      filename: asset
    });
  }
  return context;
}

test('reader UI binding gets authenticated snapshot and reuses operation ID', async () => {
  const calls = [];
  const g = browser();
  const request = g.NovelightFormalRewardTransport.createFormalRewardTransport({
    endpoint: '/api/formal-reward-reader',
    getAccessToken: async () => 'synthetic-session',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () =>
          options.method === 'GET'
            ? {
                serverVerified: true,
                formalEnabled: false,
                account: { level: 50 }
              }
            : { ok: true, status: 'request_received' }
      };
    }
  });
  const reader =
    g.NovelightFormalRewardReaderBindings.createFormalReaderRewardBindings({
      request,
      nextOperationId: () => UUID
    });
  assert.equal((await reader.fetchSnapshot()).account.level, 50);
  assert.equal(
    (await reader.onExchange({ amountPoints: 30000 })).status,
    'request_received'
  );
  assert.equal(calls[0].url, '/api/formal-reward-reader');
  assert.equal(
    calls[0].options.headers.Authorization,
    'Bearer synthetic-session'
  );
  assert.equal(JSON.parse(calls[1].options.body).operationId, UUID);
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.cache, 'no-store');
});

test('admin queue and refund view share injected authenticated transport', async () => {
  const calls = [];
  const g = browser();
  const request = g.NovelightFormalRewardTransport.createFormalRewardTransport({
    endpoint: '/api/formal-reward-admin',
    getAccessToken: async () => 'operator-session',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ ok: true, status: 'queue_ready', items: [] })
      };
    }
  });
  const admin = g.NovelightFormalRewardAdmin.createFormalAdminBindings({
    request
  });
  await admin.loadQueue();
  await admin.loadRefunds();
  await admin.onResolve({ operationId: UUID, action: 'release_unfulfilled' });
  assert.equal(calls[1].url, '/api/formal-reward-admin?view=refunds');
  assert.equal(JSON.parse(calls[2].options.body).operationId, UUID);
  assert.equal(
    calls[2].options.headers.Authorization,
    'Bearer operator-session'
  );
});

test('invalid URL, expired session, unsupported method never fetch', async () => {
  const g = browser();
  const make = g.NovelightFormalRewardTransport.createFormalRewardTransport;
  assert.throws(
    () =>
      make({
        endpoint: 'https://example.com/api',
        getAccessToken: async () => 'x',
        fetchImpl: async () => ({})
      }),
    /Approved same-origin endpoint/
  );
  let invoked = 0;
  const request = make({
    endpoint: '/api/reward',
    getAccessToken: async () => null,
    fetchImpl: async () => {
      invoked++;
      return {};
    }
  });
  await assert.rejects(request({ method: 'GET' }), /SESSION_MISSING/);
  await assert.rejects(request({ method: 'DELETE' }), /method rejected/);
  assert.equal(invoked, 0);
});
