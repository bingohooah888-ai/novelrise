import assert from 'node:assert/strict';
import test from 'node:test';
import { createThumbnailRenderHandler } from '../api/_lib/thumbnail-render.js';

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    }
  };
}

function queryBuilder(row) {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    limit() {
      return this;
    },
    async maybeSingle() {
      return { data: row, error: null };
    }
  };
}

test('thumbnail render endpoint is POST-only', async () => {
  const handler = createThumbnailRenderHandler({ supabase: {} });
  const res = responseRecorder();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test(
  'thumbnail render endpoint rejects missing bearer authentication',
  async () => {
    const handler = createThumbnailRenderHandler({ supabase: {} });
    const res = responseRecorder();
    await handler({ method: 'POST', headers: {}, body: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.error, 'Unauthorized');
  }
);

test('authenticated caller still needs valid render metadata', async () => {
  const supabase = {
    auth: {
      async getUser() {
        return { data: { user: { id: 'user-1' } }, error: null };
      }
    }
  };
  const handler = createThumbnailRenderHandler({ supabase });
  const res = responseRecorder();
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
      body: { action: 'prepare-upload', fileSize: 123 }
    },
    res
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, 'Invalid thumbnail render request');
});

test(
  'signed upload is issued only for an owned unchanged composition',
  async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const revision = '22222222-2222-4222-8222-222222222222';
    const supabase = {
      auth: {
        async getUser() {
          return { data: { user: { id: userId } }, error: null };
        }
      },
      from(table) {
        if (table === 'novels') {
          return queryBuilder({ id: 42, user_id: userId });
        }
        if (table === 'novel_thumbnail_compositions') {
          return queryBuilder({ novel_id: 42, revision });
        }
        throw new Error(`unexpected table ${table}`);
      },
      storage: {
        from(bucket) {
          assert.equal(bucket, 'novel-thumbnail-renders');
          return {
            async createSignedUploadUrl(path) {
              assert.match(path, /^renders\/42\/[0-9a-f-]{36}\.webp$/i);
              return { data: { token: 'signed-token' }, error: null };
            }
          };
        }
      }
    };
    const handler = createThumbnailRenderHandler({ supabase });
    const res = responseRecorder();
    await handler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' },
        body: {
          action: 'prepare-upload',
          novelId: '42',
          revision,
          fileSize: 100000
        }
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.token, 'signed-token');
    assert.equal(res.payload.maxFileSize, 2 * 1024 * 1024);
  }
);

test(
  'signed upload is denied when the novel is not owned by the caller',
  async () => {
    const revision = '22222222-2222-4222-8222-222222222222';
    const supabase = {
      auth: {
        async getUser() {
          return { data: { user: { id: 'owner-a' } }, error: null };
        }
      },
      from(table) {
        if (table === 'novels') {
          return queryBuilder({ id: 42, user_id: 'owner-b' });
        }
        throw new Error(`unexpected table ${table}`);
      }
    };
    const handler = createThumbnailRenderHandler({ supabase });
    const res = responseRecorder();
    await handler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' },
        body: {
          action: 'prepare-upload',
          novelId: '42',
          revision,
          fileSize: 100000
        }
      },
      res
    );
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.error, 'Thumbnail composition changed');
  }
);
