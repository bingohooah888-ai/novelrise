import { createHmac, timingSafeEqual } from 'node:crypto';

const TEST_TOKEN_NAMESPACE = 'novelight-beta-author-invite-preview:v1';

function secret(env) {
  const value = String(env?.SUPABASE_SECRET_KEY ?? '');
  if (!value) throw new Error('SUPABASE_SECRET_KEY is unavailable');
  return value;
}

export function createInvitePreviewToken(env = process.env) {
  const deployment = String(env?.VERCEL_GIT_COMMIT_SHA ?? 'local');
  return createHmac('sha256', secret(env))
    .update(`${TEST_TOKEN_NAMESPACE}:${deployment}`, 'utf8')
    .digest('base64url');
}

export function isInvitePreviewToken(token, env = process.env) {
  const candidate = String(token ?? '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(candidate)) return false;

  const expected = createInvitePreviewToken(env);
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}
