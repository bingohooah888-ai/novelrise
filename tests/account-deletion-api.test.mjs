import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONFIRMATION_TEXT,
  createDeleteAccountHandler
} from '../api/_lib/delete-account.js';

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

function request(overrides = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token' },
    body: { confirmation: CONFIRMATION_TEXT },
    ...overrides
  };
}

function createQueryResult(result, calls, table) {
  const state = { operation: 'query' };
  const builder = {
    select(columns) {
      state.operation = 'select';
      calls.push({ type: 'select', table, columns });
      return builder;
    },
    delete() {
      state.operation = 'delete';
      calls.push({ type: 'delete', table });
      return builder;
    },
    eq(column, value) {
      calls.push({
        type: 'filter',
        operation: state.operation,
        table,
        filter: 'eq',
        column,
        value
      });
      return builder;
    },
    in(column, values) {
      calls.push({
        type: 'filter',
        operation: state.operation,
        table,
        filter: 'in',
        column,
        values
      });
      return builder;
    },
    async maybeSingle() {
      calls.push({
        type: 'terminal',
        operation: state.operation,
        table,
        filter: 'maybeSingle'
      });
      return result;
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    }
  };
  return builder;
}

function dependencies({
  authenticated = true,
  stripeListError = null,
  storageErrorBucket = null,
  authDeleteError = null
} = {}) {
  const calls = {
    authTokens: [],
    authDeletes: [],
    queries: [],
    storage: [],
    stripeList: [],
    stripeRetrieve: [],
    stripeCancel: []
  };

  const tableResults = {
    profiles: {
      data: {
        avatar_path: 'verified-user/avatar.webp',
        stripe_customer_id: 'cus_123',
        stripe_subscription_id: 'sub_profile'
      },
      error: null
    },
    novels: { data: [{ id: 10 }, { id: 11 }], error: null },
    episode_illustrations: {
      data: [
        { storage_path: '10/1/a.webp' },
        { storage_path: '10/1/a.webp' },
        { storage_path: '11/2/b.webp' }
      ],
      error: null
    },
    novel_thumbnail_compositions: {
      data: [
        { render_storage_path: '10/render.webp' },
        { render_storage_path: '11/render.webp' }
      ],
      error: null
    }
  };

  const supabase = {
    auth: {
      async getUser(token) {
        calls.authTokens.push(token);
        return authenticated
          ? { data: { user: { id: 'verified-user' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } };
      },
      admin: {
        async deleteUser(userId) {
          calls.authDeletes.push(userId);
          return authDeleteError
            ? { data: null, error: authDeleteError }
            : { data: { user: null }, error: null };
        }
      }
    },
    from(table) {
      const fallback = { data: null, error: null };
      return createQueryResult(
        tableResults[table] || fallback,
        calls.queries,
        table
      );
    },
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            calls.storage.push({ bucket, paths });
            return bucket === storageErrorBucket
              ? { data: null, error: new Error(`storage failed: ${bucket}`) }
              : { data: paths, error: null };
          }
        };
      }
    }
  };

  const stripe = {
    subscriptions: {
      async list(params) {
        calls.stripeList.push(params);
        if (stripeListError) throw stripeListError;
        return {
          data: [
            { id: 'sub_active', status: 'active' },
            { id: 'sub_canceled', status: 'canceled' }
          ],
          has_more: false
        };
      },
      async retrieve(id) {
        calls.stripeRetrieve.push(id);
        return { id, status: 'active' };
      },
      async cancel(id) {
        calls.stripeCancel.push(id);
        return { id, status: 'canceled' };
      }
    }
  };

  return {
    calls,
    handler: createDeleteAccountHandler({ stripe, supabase })
  };
}

test('account deletion endpoint is POST-only and requires bearer authentication', async () => {
  const { handler, calls } = dependencies();

  let response = responseState();
  await handler(request({ method: 'GET' }), response.res);
  assert.equal(response.state.statusCode, 405);
  assert.equal(response.state.headers.Allow, 'POST');
  assert.deepEqual(calls.authTokens, []);

  response = responseState();
  await handler(request({ headers: {} }), response.res);
  assert.equal(response.state.statusCode, 401);
  assert.deepEqual(calls.authTokens, []);
});

test('account deletion rejects an invalid session and incorrect confirmation', async () => {
  let fixture = dependencies({ authenticated: false });
  let response = responseState();
  await fixture.handler(request(), response.res);
  assert.equal(response.state.statusCode, 401);
  assert.deepEqual(fixture.calls.authDeletes, []);

  fixture = dependencies();
  response = responseState();
  await fixture.handler(
    request({ body: { confirmation: '削除する' } }),
    response.res
  );
  assert.equal(response.state.statusCode, 400);
  assert.deepEqual(response.state.body, { error: 'CONFIRMATION_REQUIRED' });
  assert.deepEqual(fixture.calls.authDeletes, []);
});

test('successful account deletion stops recurring billing, removes storage, then deletes account data', async () => {
  const { handler, calls } = dependencies();
  const response = responseState();

  await handler(request(), response.res);

  assert.equal(response.state.statusCode, 200);
  assert.deepEqual(response.state.body, { ok: true });
  assert.deepEqual(calls.authTokens, ['valid-token']);
  assert.deepEqual(calls.stripeList, [
    { customer: 'cus_123', status: 'all', limit: 100 }
  ]);
  assert.deepEqual(calls.stripeRetrieve, ['sub_profile']);
  assert.deepEqual(calls.stripeCancel, ['sub_active', 'sub_profile']);
  assert.deepEqual(calls.storage, [
    { bucket: 'author-avatars', paths: ['verified-user/avatar.webp'] },
    {
      bucket: 'episode-illustrations',
      paths: ['10/1/a.webp', '11/2/b.webp']
    },
    {
      bucket: 'novel-thumbnail-renders',
      paths: ['10/render.webp', '11/render.webp']
    }
  ]);
  assert.deepEqual(calls.authDeletes, ['verified-user']);

  const destructiveTables = calls.queries
    .filter((call) => call.type === 'delete')
    .map((call) => call.table);
  assert.deepEqual(destructiveTables, [
    'episode_illustrations',
    'novels',
    'episodes'
  ]);
});

test('Stripe cancellation failure blocks all destructive account deletion work', async () => {
  const { handler, calls } = dependencies({
    stripeListError: new Error('stripe unavailable')
  });
  const response = responseState();

  await handler(request(), response.res);

  assert.equal(response.state.statusCode, 500);
  assert.deepEqual(response.state.body, { error: 'ACCOUNT_DELETE_FAILED' });
  assert.deepEqual(calls.storage, []);
  assert.deepEqual(
    calls.queries.filter((call) => call.type === 'delete'),
    []
  );
  assert.deepEqual(calls.authDeletes, []);
});

test('storage cleanup failure stops database and Auth deletion after billing has been stopped', async () => {
  const { handler, calls } = dependencies({
    storageErrorBucket: 'episode-illustrations'
  });
  const response = responseState();

  await handler(request(), response.res);

  assert.equal(response.state.statusCode, 500);
  assert.deepEqual(calls.stripeCancel, ['sub_active', 'sub_profile']);
  assert.deepEqual(
    calls.queries.filter((call) => call.type === 'delete'),
    []
  );
  assert.deepEqual(calls.authDeletes, []);
});

test('Auth deletion failure is surfaced instead of falsely reporting success', async () => {
  const { handler, calls } = dependencies({
    authDeleteError: new Error('auth delete failed')
  });
  const response = responseState();

  await handler(request(), response.res);

  assert.equal(response.state.statusCode, 500);
  assert.deepEqual(calls.authDeletes, ['verified-user']);
});
