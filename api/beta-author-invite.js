import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function setPrivateHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function requestHost(req) {
  const forwarded = String(req.headers['x-forwarded-host'] ?? '')
    .split(',')[0]
    .trim();
  return forwarded || String(req.headers.host ?? '').trim();
}

function isSameOriginRequest(req) {
  const origin = String(req.headers.origin ?? '').trim();
  if (!origin) return true;
  const host = requestHost(req);
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function bodyObject(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.length <= 4096) {
    try {
      const parsed = JSON.parse(req.body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function tokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function relationUnavailable(error) {
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    String(error?.message ?? '').includes('beta_author_invites')
  );
}

export default async function handler(req, res) {
  setPrivateHeaders(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  if (!isSameOriginRequest(req)) {
    return res.status(403).json({ error: 'ORIGIN_REJECTED' });
  }

  const body = bodyObject(req);
  const token = String(body?.token ?? '').trim();
  if (!TOKEN_PATTERN.test(token)) {
    return res.status(200).json({ valid: false });
  }

  try {
    const hash = tokenHash(token);
    const { data: invite, error: inviteError } = await supabase
      .from('beta_author_invites')
      .select('preregistration_id,expires_at,sent_at,consumed_at,revoked_at')
      .eq('token_hash', hash)
      .maybeSingle();

    if (inviteError) throw inviteError;
    if (
      !invite ||
      !invite.sent_at ||
      invite.consumed_at ||
      invite.revoked_at ||
      Date.parse(invite.expires_at) <= Date.now()
    ) {
      return res.status(200).json({ valid: false });
    }

    const { data: preregistration, error: preregistrationError } =
      await supabase
        .from('beta_author_preregistrations')
        .select('id,status,auth_user_id')
        .eq('id', invite.preregistration_id)
        .maybeSingle();
    if (preregistrationError) throw preregistrationError;

    const valid =
      Boolean(preregistration) &&
      preregistration.status !== 'cancelled' &&
      !preregistration.auth_user_id;

    return res.status(200).json({
      valid,
      expiresAt: valid ? invite.expires_at : null
    });
  } catch (error) {
    if (relationUnavailable(error)) {
      return res.status(503).json({ error: 'INVITE_SERVICE_UNAVAILABLE' });
    }
    console.error('NOVELIGHT beta author invite validation failed', {
      code: error?.code ?? 'unknown'
    });
    return res.status(503).json({ error: 'INVITE_SERVICE_UNAVAILABLE' });
  }
}
