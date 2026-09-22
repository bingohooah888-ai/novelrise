import { createHash, createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from './_lib/admin-auth.js';
import { getAppBaseUrl } from './_lib/app-base-url.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TOKEN_VERSION_NAMESPACE = 'novelight-beta-author-invite:v1';
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM = 'NOVELIGHT <noreply@novelight.jp>';
const MAX_PENDING_IDS = 500;

function privateHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function relationUnavailable(error) {
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    String(error?.message ?? '').includes('beta_author_invites')
  );
}

function parseId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function inviteToken(preregistrationId, version) {
  const secret = String(process.env.SUPABASE_SECRET_KEY ?? '');
  if (!secret) throw new Error('SUPABASE_SECRET_KEY is unavailable');
  return createHmac('sha256', secret)
    .update(
      `${TOKEN_VERSION_NAMESPACE}:${preregistrationId}:${version}`,
      'utf8'
    )
    .digest('base64url');
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function inviteUrl(token) {
  const url = new URL('/signup.html', getAppBaseUrl(process.env));
  url.hash = `invite=${encodeURIComponent(token)}`;
  return url.toString();
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatJst(iso) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(iso));
}

function emailPayload({ to, url, expiresAt }) {
  const escapedUrl = htmlEscape(url);
  const expires = htmlEscape(formatJst(expiresAt));
  return {
    from: FROM,
    to: [to],
    subject: '【NOVELIGHT】先行利用のご案内（9月28日開始）',
    text: `NOVELIGHTへ先行登録いただきありがとうございます。

2026年9月28日から、先行作者プレオープンをご利用いただけます。

以下の専用URLから会員登録してください。
${url}

このURLは先行登録者ご本人専用です。他の方へ共有しないでください。
有効期限：${formatJst(expiresAt)}
一般β公開：2026年9月30日

URLが利用できない場合は、NOVELIGHTのお問い合わせ窓口からご連絡ください。

NOVELIGHT
すべての物語に、光を。`,
    html: `<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8"><title>NOVELIGHT 先行利用のご案内</title></head>
  <body style="margin:0;padding:0;background:#f5f4ef;color:#1d2433;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Yu Gothic',sans-serif">
    <div style="max-width:620px;margin:0 auto;padding:32px 20px">
      <div style="background:#fff;border:1px solid #e5dfcf;border-radius:16px;padding:32px">
        <p style="margin:0 0 10px;color:#8a6f2d;font-size:13px;font-weight:700;letter-spacing:.08em">NOVELIGHT FOUNDING AUTHORS</p>
        <h1 style="margin:0 0 20px;font-size:24px;line-height:1.4">先行利用のご案内</h1>
        <p style="line-height:1.8">NOVELIGHTへ先行登録いただきありがとうございます。</p>
        <p style="line-height:1.8"><strong>2026年9月28日</strong>から、一般公開に先駆けて作品投稿などの準備を始められます。</p>
        <p style="margin:28px 0;text-align:center"><a href="${escapedUrl}" style="display:inline-block;padding:14px 24px;border-radius:9px;background:#17233f;color:#fff;text-decoration:none;font-weight:700">先行利用を始める</a></p>
        <p style="line-height:1.7;font-size:13px;color:#596273">ボタンが開けない場合は、次のURLをブラウザへ貼り付けてください。<br><a href="${escapedUrl}" style="word-break:break-all">${escapedUrl}</a></p>
        <div style="margin-top:24px;padding:16px;border-radius:10px;background:#f7f5ee;font-size:13px;line-height:1.7">
          <strong>このURLはご本人専用です。</strong><br>
          他の方へ共有しないでください。<br>
          有効期限：${expires}<br>
          一般β公開：2026年9月30日
        </div>
        <p style="margin:24px 0 0;font-size:12px;line-height:1.7;color:#717784">このメールは、NOVELIGHT β版の公開・参加に関する連絡へ同意して先行登録した方へお送りしています。</p>
      </div>
    </div>
  </body>
</html>`
  };
}

async function campaignState() {
  const { data, error } = await supabase
    .from('beta_author_preregistration_config')
    .select('state')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data?.state ?? null;
}

async function pendingInviteIds() {
  const { data: preregistrations, error: preregistrationError } =
    await supabase
      .from('beta_author_preregistrations')
      .select('id')
      .neq('status', 'cancelled')
      .is('auth_user_id', null)
      .order('created_at', { ascending: true })
      .limit(MAX_PENDING_IDS);
  if (preregistrationError) throw preregistrationError;

  const ids = (preregistrations ?? []).map((row) => row.id);
  if (!ids.length) return [];

  const { data: invites, error: inviteError } = await supabase
    .from('beta_author_invites')
    .select('preregistration_id,sent_at,consumed_at')
    .in('preregistration_id', ids);
  if (inviteError) throw inviteError;

  const completed = new Set(
    (invites ?? [])
      .filter((row) => row.sent_at && !row.consumed_at)
      .map((row) => row.preregistration_id)
  );
  return ids.filter((id) => !completed.has(id));
}

async function loadPreregistration(id) {
  const { data, error } = await supabase
    .from('beta_author_preregistrations')
    .select('id,email,status,auth_user_id,invite_sent_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadInvite(preregistrationId) {
  const { data, error } = await supabase
    .from('beta_author_invites')
    .select(
      'id,preregistration_id,token_version,token_hash,issued_at,expires_at,sent_at,consumed_at,revoked_at,resend_email_id,delivery_status'
    )
    .eq('preregistration_id', preregistrationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function prepareInvite(preregistrationId) {
  const now = new Date();
  const current = await loadInvite(preregistrationId);
  const reusable =
    current &&
    !current.revoked_at &&
    !current.consumed_at &&
    Date.parse(current.expires_at) > now.getTime();

  const currentVersion = current?.token_version ?? 0;
  const currentToken = reusable
    ? inviteToken(preregistrationId, currentVersion)
    : null;
  const currentTokenHash = currentToken ? hashToken(currentToken) : null;

  if (reusable && current.token_hash === currentTokenHash) {
    return { invite: current, token: currentToken };
  }

  // A changed server secret must also advance the invite version so the
  // provider idempotency key never refers to two different payloads.
  const version = currentVersion + 1;
  const token = inviteToken(preregistrationId, version);
  const tokenHash = hashToken(token);
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
  const payload = {
    preregistration_id: preregistrationId,
    token_version: version,
    token_hash: tokenHash,
    issued_at: issuedAt,
    expires_at: expiresAt,
    sent_at: null,
    consumed_at: null,
    redeemed_auth_user_id: null,
    revoked_at: null,
    resend_email_id: null,
    delivery_status: 'prepared',
    updated_at: issuedAt
  };

  const { data, error } = await supabase
    .from('beta_author_invites')
    .upsert(payload, { onConflict: 'preregistration_id' })
    .select(
      'id,preregistration_id,token_version,token_hash,issued_at,expires_at,sent_at,consumed_at,revoked_at,resend_email_id,delivery_status'
    )
    .single();
  if (error) throw error;
  return { invite: data, token };
}

async function markPreregistrationInvited(preregistration) {
  if (!preregistration || preregistration.status === 'cancelled') return;
  const patch = { updated_at: new Date().toISOString() };
  if (!preregistration.invite_sent_at) patch.invite_sent_at = patch.updated_at;
  if (['preregistered', 'verified'].includes(preregistration.status)) {
    patch.status = 'invited';
  }
  const { error } = await supabase
    .from('beta_author_preregistrations')
    .update(patch)
    .eq('id', preregistration.id);
  if (error) throw error;
}

async function sendInvite(preregistration) {
  const apiKey = String(process.env.RESEND_API_KEY ?? '').trim();
  if (!apiKey) {
    const error = new Error('RESEND_API_KEY is unavailable');
    error.code = 'RESEND_NOT_CONFIGURED';
    throw error;
  }

  const prepared = await prepareInvite(preregistration.id);
  const { invite, token } = prepared;

  if (invite.consumed_at) {
    return { result: 'consumed' };
  }
  if (invite.sent_at) {
    await markPreregistrationInvited(preregistration);
    return { result: 'already_sent' };
  }

  const url = inviteUrl(token);
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key':\n        `novelight-beta-author-invite-${preregistration.id}-v${invite.token_version}`
    },
    body: JSON.stringify(
      emailPayload({
        to: preregistration.email,
        url,
        expiresAt: invite.expires_at
      })
    )
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok || !responseBody?.id) {
    const { error: statusError } = await supabase
      .from('beta_author_invites')
      .update({
        delivery_status: `error_${response.status}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', invite.id);
    if (statusError) {
      console.error('NOVELIGHT invite delivery status update failed', {
        code: statusError?.code ?? 'unknown'
      });
    }
    const error = new Error('Resend rejected invite');
    error.code = 'RESEND_REJECTED';
    error.httpStatus = response.status;
    throw error;
  }

  const sentAt = new Date().toISOString();
  const { error: inviteUpdateError } = await supabase
    .from('beta_author_invites')
    .update({
      sent_at: sentAt,
      resend_email_id: String(responseBody.id).slice(0, 200),
      delivery_status: 'accepted',
      updated_at: sentAt
    })
    .eq('id', invite.id);
  if (inviteUpdateError) throw inviteUpdateError;

  await markPreregistrationInvited(preregistration);
  return { result: 'sent' };
}

export default async function handler(req, res) {
  privateHeaders(res);

  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const admin = await requireAdmin({ req, res, supabase, env: process.env });
  if (!admin) return;

  try {
    const state = await campaignState();

    if (req.method === 'GET') {
      let pendingIds = [];
      let storageReady = true;
      try {
        pendingIds = await pendingInviteIds();
      } catch (error) {
        if (!relationUnavailable(error)) throw error;
        storageReady = false;
      }
      return res.status(200).json({
        state,
        storageReady,
        resendReady: Boolean(String(process.env.RESEND_API_KEY ?? '').trim()),
        canSend:
          state === 'AUTHOR_PREOPEN' &&
          storageReady &&
          Boolean(String(process.env.RESEND_API_KEY ?? '').trim()),
        pendingIds
      });
    }

    if (state !== 'AUTHOR_PREOPEN') {
      return res.status(409).json({ error: 'INVITE_SEND_NOT_OPEN' });
    }

    const id = parseId(req.body?.id);
    if (!id) return res.status(400).json({ error: 'INVALID_REQUEST' });

    const preregistration = await loadPreregistration(id);
    if (
      !preregistration ||
      preregistration.status === 'cancelled' ||
      preregistration.auth_user_id
    ) {
      return res.status(409).json({ error: 'INVITE_NOT_ELIGIBLE' });
    }

    const outcome = await sendInvite(preregistration);
    return res.status(200).json(outcome);
  } catch (error) {
    if (relationUnavailable(error)) {
      return res.status(503).json({ error: 'INVITE_STORAGE_UNAVAILABLE' });
    }
    if (error?.code === 'RESEND_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'RESEND_NOT_CONFIGURED' });
    }
    if (error?.code === 'RESEND_REJECTED') {
      console.error('NOVELIGHT invite send rejected by provider', {
        status: error.httpStatus ?? 0
      });
      return res.status(502).json({ error: 'INVITE_DELIVERY_FAILED' });
    }
    console.error('NOVELIGHT beta author invite ADMIN operation failed', {
      code: error?.code ?? 'unknown'
    });
    return res.status(500).json({ error: 'INVITE_OPERATION_FAILED' });
  }
}
