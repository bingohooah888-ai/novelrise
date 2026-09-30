import assert from 'node:assert/strict';
import test from 'node:test';
import * as cleanup from '../api/_lib/thumbnail-finalize-cleanup.js';

const { cleanupFailedThumbnailFinalize } = cleanup;
const REVISION = '33333333-3333-4333-8333-333333333333';
const AUTHORIZATION = 'Bearer valid-access-token';

function query(row, error = null) {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async maybeSingle() {
      return { data: row, error };
    }
  };
}

function createSupabase({
  novel = { id: 42 },
  composition = { render_storage_path: null },
  removeError = null,
  authError = null
} = {}) {
  const removed = [];
  return {
    removed,
    client: {
      auth: {
        async getUser(token) {
          assert.equal(token, 'valid-access-token');
          return authError
            ? { data: { user: null }, error: authError }
            : { data: { user: { id: 'owner-user' } }, error: null };
        }
      },
      from(table) {
        if (table === 'novels') return query(novel);
        assert.equal(table, 'novel_thumbnail_compositions');
        return query(composition);
      },
      storage: {
        from(bucket) {
          assert.equal(bucket, 'novel-thumbnail-renders');
          return {
            async remove(paths) {
              removed.push(...paths);
              return { error: removeError };
            }
          };
        }
      }
    }
  };
}

function body(path) {
  return {
    action: 'finalize-upload',
    novelId: '42',
    revision: REVISION,
    path
  };
}

test('removes the current authenticated unadopted upload', async () => {
  const attemptedPath = 'renders/42/11111111-1111-4111-8111-111111111111.png';
  const { client, removed } = createSupabase({
    composition: {
      render_storage_path:
        'renders/42/22222222-2222-4222-8222-222222222222.webp'
    }
  });

  const cleaned = await cleanupFailedThumbnailFinalize({
    supabase: client,
    statusCode: 409,
    authorization: AUTHORIZATION,
    body: body(attemptedPath)
  });

  assert.equal(cleaned, true);
  assert.deepEqual(removed, [attemptedPath]);
});

test('never removes an adopted render', async () => {
  const attemptedPath = 'renders/42/11111111-1111-4111-8111-111111111111.webp';
  const { client, removed } = createSupabase({
    composition: { render_storage_path: attemptedPath }
  });

  const cleaned = await cleanupFailedThumbnailFinalize({
    supabase: client,
    statusCode: 500,
    authorization: AUTHORIZATION,
    body: body(attemptedPath)
  });

  assert.equal(cleaned, false);
  assert.deepEqual(removed, []);
});

test('refuses cleanup without authenticated request context', async () => {
  let touched = false;
  const cleaned = await cleanupFailedThumbnailFinalize({
    supabase: {
      auth: {
        async getUser() {
          touched = true;
          throw new Error('must not authenticate without a bearer token');
        }
      }
    },
    statusCode: 401,
    body: body('renders/42/11111111-1111-4111-8111-111111111111.png')
  });

  assert.equal(cleaned, false);
  assert.equal(touched, false);
});

test('refuses cleanup when authenticated user does not own the novel', async () => {
  const { client, removed } = createSupabase({ novel: null });

  const cleaned = await cleanupFailedThumbnailFinalize({
    supabase: client,
    statusCode: 409,
    authorization: AUTHORIZATION,
    body: body('renders/42/11111111-1111-4111-8111-111111111111.png')
  });

  assert.equal(cleaned, false);
  assert.deepEqual(removed, []);
});

test('swallows cleanup failure', async () => {
  const { client, removed } = createSupabase({
    removeError: { message: 'cleanup unavailable' }
  });

  const cleaned = await cleanupFailedThumbnailFinalize({
    supabase: client,
    statusCode: 500,
    authorization: AUTHORIZATION,
    body: body('renders/42/11111111-1111-4111-8111-111111111111.png')
  });

  assert.equal(cleaned, false);
  assert.deepEqual(removed, [
    'renders/42/11111111-1111-4111-8111-111111111111.png'
  ]);
});

test('refuses a path for another novel before privileged access', async () => {
  let touched = false;
  const cleaned = await cleanupFailedThumbnailFinalize({
    supabase: {
      auth: {
        async getUser() {
          touched = true;
          throw new Error('must not authenticate invalid metadata');
        }
      }
    },
    statusCode: 409,
    authorization: AUTHORIZATION,
    body: {
      ...body('renders/99/11111111-1111-4111-8111-111111111111.png')
    }
  });

  assert.equal(cleaned, false);
  assert.equal(touched, false);
});
