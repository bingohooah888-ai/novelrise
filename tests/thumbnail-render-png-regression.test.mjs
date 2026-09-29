import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createThumbnailRenderHandler } from '../api/_lib/thumbnail-render.js';

const browser = await readFile('novelight-thumbnail-composer.js', 'utf8');
const api = await readFile('api/_lib/thumbnail-render.js', 'utf8');

const userId = '11111111-1111-4111-8111-111111111111';
const novelId = '123';
const revision = '33333333-3333-4333-8333-333333333333';
const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52
]);
const pngBlob = new Blob([pngBytes], { type: 'image/png' });

function makeQuery(data) {
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    limit() {
      return query;
    },
    async maybeSingle() {
      return { data, error: null };
    }
  };
  return query;
}

function makeResponse() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

function makeSupabase() {
  const state = {
    attached: [],
    preparedPath: null
  };

  const bucket = {
    async createSignedUploadUrl(path) {
      state.preparedPath = path;
      return { data: { token: 'signed-upload-token' }, error: null };
    },
    async list(prefix, options) {
      const fileName = state.preparedPath.slice(
        state.preparedPath.lastIndexOf('/') + 1
      );
      assert.equal(prefix, `renders/${novelId}`);
      assert.equal(options.search, fileName);
      return {
        data: [{ name: fileName, metadata: { mimetype: 'image/png' } }],
        error: null
      };
    },
    async download(path) {
      assert.equal(path, state.preparedPath);
      return { data: pngBlob, error: null };
    },
    getPublicUrl(path) {
      return {
        data: { publicUrl: `https://example.test/storage/${path}` }
      };
    },
    async remove() {
      throw new Error('valid PNG must not be rejected');
    }
  };

  return {
    state,
    auth: {
      async getUser() {
        return { data: { user: { id: userId } }, error: null };
      }
    },
    from(table) {
      if (table === 'novels') {
        return makeQuery({ id: Number(novelId), user_id: userId });
      }
      if (table === 'novel_thumbnail_compositions') {
        return makeQuery({ novel_id: Number(novelId), revision });
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    storage: {
      from(name) {
        assert.equal(name, 'novel-thumbnail-renders');
        return bucket;
      }
    },
    async rpc(name, args) {
      state.attached.push({ name, args });
      return { data: true, error: null };
    }
  };
}

async function request(handler, body) {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body
  };
  const res = makeResponse();
  await handler(req, res);
  return res;
}

test('frontend propagates Safari PNG Blob MIME through prepare, signed upload, and finalize', () => {
  assert.match(browser, /contentType = String\(blob\.type \|\| ''\)/u);
  assert.match(
    browser,
    /contentType !== 'image\/webp' && contentType !== 'image\/png'/u
  );
  assert.match(browser, /fileSize: blob\.size,[\s\S]*contentType/u);
  assert.match(
    browser,
    /uploadToSignedUrl\([\s\S]*contentType,[\s\S]*upsert: false/u
  );
  assert.match(
    browser,
    /action: 'finalize-upload',[\s\S]*path: prepared\.path/u
  );
});

test('PNG prepare creates .png path and finalize attaches that exact path', async () => {
  assert.equal(pngBlob.type, 'image/png');
  const supabase = makeSupabase();
  const handler = createThumbnailRenderHandler({ supabase });

  const prepared = await request(handler, {
    action: 'prepare-upload',
    novelId,
    revision,
    fileSize: pngBlob.size,
    contentType: pngBlob.type
  });

  assert.equal(prepared.statusCode, 200);
  assert.equal(prepared.payload.contentType, 'image/png');
  assert.match(prepared.payload.path, /^renders\/123\/[0-9a-f-]{36}\.png$/iu);

  const finalized = await request(handler, {
    action: 'finalize-upload',
    novelId,
    revision,
    path: prepared.payload.path
  });

  assert.equal(finalized.statusCode, 200);
  assert.equal(supabase.state.attached.length, 1);
  assert.equal(
    supabase.state.attached[0].name,
    'novelight_attach_thumbnail_render'
  );
  assert.equal(
    supabase.state.attached[0].args.p_storage_path,
    prepared.payload.path
  );
  assert.match(supabase.state.attached[0].args.p_storage_path, /\.png$/u);
});

test('thumbnail API path contract is not WebP-only', () => {
  const pathPatternLine = api
    .split('\n')
    .find((line) => line.includes('const PATH_PATTERN'));

  assert.ok(pathPatternLine);
  assert.match(pathPatternLine, /\(webp\|png\)/u);
  assert.doesNotMatch(pathPatternLine, /\\\.webp\$/u);
  assert.match(
    api,
    /extension === 'png' \? isPngSignature\(bytes\) : isWebpSignature\(bytes\)/u
  );
});
