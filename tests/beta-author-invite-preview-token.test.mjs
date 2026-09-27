import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import handler from '../api/beta-author-invite-preview.js';
import {
  createInvitePreviewToken,
  isInvitePreviewToken
} from '../api/_lib/beta-author-invite-preview-token.js';

const env = {
  SUPABASE_SECRET_KEY: 'test-secret-not-for-production',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40)
};

function responseRecorder() {
  const record = { headers: {}, statusCode: null, body: null };
  return {
    record,
    response: {
      setHeader(name, value) {
        record.headers[name] = value;
      },
      status(statusCode) {
        record.statusCode = statusCode;
        return this;
      },
      json(body) {
        record.body = body;
        return this;
      }
    }
  };
}

test('invite preview token validates only for its deployment-bound namespace', () => {
  const token = createInvitePreviewToken(env);

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(isInvitePreviewToken(token, env), true);
  assert.equal(
    isInvitePreviewToken(token, {
      ...env,
      VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40)
    }),
    false
  );
});

test('real invite namespace token cannot be accepted as a preview token', () => {
  const realInviteShapedToken = createHmac('sha256', env.SUPABASE_SECRET_KEY)
    .update('novelight-beta-author-invite:v1:144:1', 'utf8')
    .digest('base64url');

  assert.equal(isInvitePreviewToken(realInviteShapedToken, env), false);
  assert.equal(isInvitePreviewToken('not-a-token', env), false);
});

test('preview validation endpoint returns read-only capabilities without persistence', async (t) => {
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  const previousSha = process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
  process.env.VERCEL_GIT_COMMIT_SHA = env.VERCEL_GIT_COMMIT_SHA;
  t.after(() => {
    if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousSecret;
    if (previousSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previousSha;
  });

  const { record, response } = responseRecorder();
  await handler(
    {
      method: 'POST',
      body: { token: createInvitePreviewToken(env) }
    },
    response
  );

  assert.equal(record.statusCode, 200);
  assert.deepEqual(record.body, {
    valid: true,
    mode: 'invite_preview',
    authCreationEnabled: false,
    dataMutationEnabled: false
  });
  assert.equal(record.headers['Cache-Control'], 'no-store, max-age=0');
});
