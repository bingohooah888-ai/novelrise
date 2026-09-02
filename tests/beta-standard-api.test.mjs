import assert from 'node:assert/strict';
import test from 'node:test';

import { createBetaStandardHandler } from '../api/activate-beta-standard.js';

function responseState() {
  const state = { statusCode: null, body: null, headers: {} };
  return {
    state,
    res: {
      setHeader(name, value) {
        state.headers[name] = value;
      },
      status(code) {
        state.statusCode = code;
        return this;
      },
      json(body) {
        state.body = body;
        return this;
      }
    }
  };
}

function createDependencies({ authUser = { id: 'user-123' }, authError = null, rpcData = [{ plan: 'standard', payment_status: 'beta_free' }], rpcError = null } = {}) {
  const calls = { tokens: [], rpcs: [] };
  const supabase = {
    auth: {
      async getUser(token) {
        calls.tokens.push(token);
        return { data: { user: authUser }, error: authError };
      }
    },
    async rpc(name, args) {
      calls.rpcs.push({ name, args });
      return { data: rpcData, error: rpcError };
    }
  };
  return { supabase, calls };
}

test('beta Standard activation is POST-only and disables caching', async () => {
  const dependencies = createDependencies();
  const handler = createBetaStandardHandler(dependencies);
  const { res, state } = responseState();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(state.statusCode, 405);
  assert.deepEqual(state.body, { error: 'Method not allowed' });
  assert.equal(state.headers['Cache-Control'], 'no-store');
  assert.equal(dependencies.calls.tokens.length, 0);
  assert.equal(dependencies.calls.rpcs.length, 0);
});

test('beta Standard activation requires a valid authenticated bearer user', async () => {
  for (const authorization of [undefined, '', 'Basic abc', 'Bearer']) {
    const dependencies = createDependencies();
    const handler = createBetaStandardHandler(dependencies);
    const { res, state } = responseState();
    await handler({ method: 'POST', headers: { authorization } }, res);
    assert.equal(state.statusCode, 401);
    assert.equal(dependencies.calls.rpcs.length, 0);
  }

  const dependencies = createDependencies({ authUser: null, authError: new Error('invalid') });
  const handler = createBetaStandardHandler(dependencies);
  const { res, state } = responseState();
  await handler({ method: 'POST', headers: { authorization: 'Bearer token-123' } }, res);
  assert.equal(state.statusCode, 401);
  assert.equal(dependencies.calls.rpcs.length, 0);
});

test('beta Standard activation binds the entitlement to the authenticated user and never accepts billing input', async () => {
  const dependencies = createDependencies();
  const handler = createBetaStandardHandler(dependencies);
  const { res, state } = responseState();
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: { userId: 'attacker-selected-user', card: 'should-not-be-used', plan: 'premium' }
    },
    res
  );

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { plan: 'standard', paymentStatus: 'beta_free', mode: 'beta_free' });
  assert.deepEqual(dependencies.calls.tokens, ['token-123']);
  assert.deepEqual(dependencies.calls.rpcs, [
    {
      name: 'novelight_activate_beta_standard',
      args: { p_user_id: 'user-123' }
    }
  ]);
});

test('beta Standard activation fails closed when a paid or entitled billing state conflicts', async () => {
  const dependencies = createDependencies({
    rpcData: null,
    rpcError: { message: 'beta_standard_entitled_subscription_exists' }
  });
  const handler = createBetaStandardHandler(dependencies);
  const { res, state } = responseState();
  await handler({ method: 'POST', headers: { authorization: 'Bearer token-123' } }, res);
  assert.equal(state.statusCode, 409);
  assert.deepEqual(state.body, {
    error: 'Billing account needs synchronization',
    code: 'billing_state_conflict'
  });
});

test('beta Standard activation rejects unexpected RPC results', async (t) => {
  t.mock.method(console, 'error', () => {});
  const dependencies = createDependencies({ rpcData: [{ plan: 'premium', payment_status: 'active' }] });
  const handler = createBetaStandardHandler(dependencies);
  const { res, state } = responseState();
  await handler({ method: 'POST', headers: { authorization: 'Bearer token-123' } }, res);
  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, { error: 'Beta Standard activation failed' });
});
