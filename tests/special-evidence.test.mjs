import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evidencePath,
  createSpecialEvidenceHandler
} from '../api/admin-special-evidence.js';

const id = '11111111-1111-4111-8111-111111111111';
const fileId = '22222222-2222-4222-8222-222222222222';
function response() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}
function store() {
  let uploadedPath = '';
  const db = {
    from(name) {
      assert.equal(name, 'special_projects');
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: { id }, error: null })
      };
    },
    storage: {
      from(name) {
        assert.equal(name, 'special-evidence');
        return {
          async createSignedUploadUrl(path) {
            uploadedPath = path;
            return { data: { token: 'signed-upload' }, error: null };
          }
        };
      }
    }
  };
  return { db, getPath: () => uploadedPath };
}
test('許諾証跡のアップロード先は企画単位でランダムかつ非公開', () => {
  assert.equal(
    evidencePath(id, 'application/pdf', fileId),
    id + '/' + fileId + '.pdf'
  );
  assert.equal(evidencePath(id, 'application/javascript', fileId), '');
  assert.equal(evidencePath('../admin', 'application/pdf', fileId), '');
});

test('ADMINだけが秘密鍵を受け取らない署名付きアップロード券を発行できる', async () => {
  const { db, getPath } = store();
  const handler = createSpecialEvidenceHandler({
    db,
    makeId: () => fileId,
    adminGuard: async () => ({ id })
  });
  const res = response();
  await handler(
    {
      method: 'POST',
      body: { project_id: id, mime_type: 'application/pdf', size: 3500 }
    },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.bucket, 'special-evidence');
  assert.equal(res.body.path, id + '/' + fileId + '.pdf');
  assert.equal(getPath(), res.body.path);
  assert.equal(res.body.token, 'signed-upload');
  assert.equal(JSON.stringify(res.body).includes('SUPABASE_SECRET_KEY'), false);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

test('許可外形式と10MBを超える証跡を拒否する', async () => {
  const { db } = store();
  const handler = createSpecialEvidenceHandler({
    db,
    makeId: () => fileId,
    adminGuard: async () => ({ id })
  });
  for (const mime_type of [
    'image/svg+xml',
    'text/html',
    'application/javascript'
  ]) {
    const res = response();
    await handler(
      { method: 'POST', body: { project_id: id, mime_type, size: 1 } },
      res
    );
    assert.equal(res.statusCode, 400);
  }
  const res = response();
  await handler(
    {
      method: 'POST',
      body: {
        project_id: id,
        mime_type: 'application/pdf',
        size: 10 * 1024 * 1024 + 1
      }
    },
    res
  );
  assert.equal(res.statusCode, 400);
});

test('管理者認証に失敗した場合は署名発行に進まない', async () => {
  const { db } = store();
  const handler = createSpecialEvidenceHandler({
    db,
    adminGuard: async ({ res }) => {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
  });
  const res = response();
  await handler({ method: 'POST', body: { project_id: id } }, res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Forbidden' });
});
