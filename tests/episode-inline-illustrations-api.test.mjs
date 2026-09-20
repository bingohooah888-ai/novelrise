import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEpisodeIllustrationsHandler,
  episodeIllustrationInternals
} from '../api/_lib/episode-illustrations.js';

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

test('episode illustration endpoint is POST-only', async () => {
  const handler = createEpisodeIllustrationsHandler({ supabase: {} });
  const res = responseRecorder();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('editor operations require bearer authentication', async () => {
  const handler = createEpisodeIllustrationsHandler({ supabase: {} });
  const res = responseRecorder();
  await handler(
    {
      method: 'POST',
      headers: {},
      body: { action: 'editor-list', episodeId: 42 }
    },
    res
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, 'Unauthorized');
});

test('prepare upload is blocked until the work-level illustration AI declaration exists', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const supabase = {
    auth: {
      async getUser() {
        return { data: { user: { id: userId } }, error: null };
      }
    },
    async rpc(name) {
      assert.equal(name, 'novelight_episode_illustration_editor_bundle');
      return {
        data: {
          can_edit: true,
          owner_user_id: userId,
          illustration_ai_usage: null,
          assets: [],
          limit: 10
        },
        error: null
      };
    }
  };
  const handler = createEpisodeIllustrationsHandler({ supabase });
  const res = responseRecorder();
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { action: 'prepare-upload', episodeId: 42, fileSize: 1000 }
    },
    res
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error, 'ILLUSTRATION_AI_USAGE_REQUIRED');
});

test('prepare upload issues a private-bucket signed upload only after editor access', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const supabase = {
    auth: {
      async getUser() {
        return { data: { user: { id: userId } }, error: null };
      }
    },
    async rpc(name) {
      if (name === 'novelight_episode_illustration_editor_bundle') {
        return {
          data: {
            can_edit: true,
            owner_user_id: userId,
            illustration_ai_usage: false,
            assets: [],
            limit: 10
          },
          error: null
        };
      }
      if (name === 'novelight_authorize_episode_illustration_upload') {
        return { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'episode-illustrations');
        return {
          async createSignedUploadUrl(path) {
            assert.match(
              path,
              new RegExp('^' + userId + '/42/[0-9a-f-]{36}\\.webp$', 'i')
            );
            return { data: { token: 'signed-upload-token' }, error: null };
          }
        };
      }
    }
  };

  const handler = createEpisodeIllustrationsHandler({ supabase });
  const res = responseRecorder();
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { action: 'prepare-upload', episodeId: 42, fileSize: 1000 }
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.bucket, 'episode-illustrations');
  assert.equal(res.payload.token, 'signed-upload-token');
  assert.equal(res.payload.maxFileSize, 10 * 1024 * 1024);
  assert.equal(res.payload.maxDeliveryEdge, 2000);
});

test('prepare upload fails closed when signed-upload issuance is rate limited', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const supabase = {
    auth: {
      async getUser() {
        return { data: { user: { id: userId } }, error: null };
      }
    },
    async rpc(name) {
      if (name === 'novelight_episode_illustration_editor_bundle') {
        return {
          data: {
            can_edit: true,
            owner_user_id: userId,
            illustration_ai_usage: false,
            assets: [],
            limit: 10
          },
          error: null
        };
      }
      if (name === 'novelight_authorize_episode_illustration_upload') {
        return {
          data: null,
          error: {
            code: 'P0001',
            message: 'EPISODE_ILLUSTRATION_UPLOAD_RATE_LIMITED'
          }
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    }
  };

  const handler = createEpisodeIllustrationsHandler({ supabase });
  const res = responseRecorder();
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { action: 'prepare-upload', episodeId: 42, fileSize: 1000 }
    },
    res
  );

  assert.equal(res.statusCode, 429);
  assert.equal(res.payload.error, 'EPISODE_ILLUSTRATION_UPLOAD_RATE_LIMITED');
});

test('reader list signs only illustration ids referenced by current published content', async () => {
  const referenced = '22222222-2222-4222-8222-222222222222';
  const unused = '33333333-3333-4333-8333-333333333333';
  const signed = [];
  const supabase = {
    async rpc(name) {
      assert.equal(name, 'novelight_public_episode_illustration_bundle');
      return {
        data: {
          content: '前半\n[[NOVELIGHT_ILLUSTRATION:' + referenced + ']]\n後半',
          illustration_ai_usage: true,
          assets: [
            {
              id: referenced,
              storage_path: 'owner/42/a.webp',
              width: 1200,
              height: 800,
              alt_text: '参照中'
            },
            {
              id: unused,
              storage_path: 'owner/42/b.webp',
              width: 900,
              height: 900,
              alt_text: '未使用'
            }
          ]
        },
        error: null
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'episode-illustrations');
        return {
          async createSignedUrl(path, seconds) {
            signed.push({ path, seconds });
            return {
              data: { signedUrl: 'https://storage.invalid/signed/' + path },
              error: null
            };
          }
        };
      }
    }
  };

  const handler = createEpisodeIllustrationsHandler({ supabase });
  const res = responseRecorder();
  await handler(
    {
      method: 'POST',
      headers: {},
      body: { action: 'reader-list', episodeId: 42 }
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.aiUsage, true);
  assert.deepEqual(
    res.payload.assets.map((asset) => asset.id),
    [referenced]
  );
  assert.equal(signed.length, 1);
  assert.equal(signed[0].path, 'owner/42/a.webp');
  assert.equal(signed[0].seconds, 600);
});

test('WebP verifier reads bounded VP8X dimensions and rejects non-WebP data', () => {
  const bytes = Buffer.alloc(30);
  bytes.write('RIFF', 0, 'ascii');
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8X', 12, 'ascii');
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(1199, 24, 3);
  bytes.writeUIntLE(799, 27, 3);
  assert.deepEqual(episodeIllustrationInternals.webpDimensions(bytes), {
    width: 1200,
    height: 800
  });
  assert.throws(
    () => episodeIllustrationInternals.webpDimensions(Buffer.from('not-webp')),
    /INVALID_WEBP/
  );
});

test('marker extraction only accepts a marker on its own line', () => {
  const good = '44444444-4444-4444-8444-444444444444';
  const bad = '55555555-5555-4555-8555-555555555555';
  const ids = episodeIllustrationInternals.referencedIds(
    '本文\n[[NOVELIGHT_ILLUSTRATION:' +
      good +
      ']]\n文章中 [[NOVELIGHT_ILLUSTRATION:' +
      bad +
      ']] は無効'
  );
  assert.deepEqual([...ids], [good]);
});
