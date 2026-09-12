import { createHmac } from 'node:crypto';
import { URL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false }
  }
);

const STATES = new Set(['PRE_REGISTRATION', 'BETA_OPEN', 'CLOSED']);
const SOURCES = new Set(['x', 'youtube', 'dm', 'direct', 'other']);
const EVENT_TYPES = new Set(['page_view', 'cta_click']);
const LEGACY_RELEASE_LABEL = '2026年9月下旬';
const BETA_RELEASE_LABEL = '2026年9月30日';

function setPrivateResponseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function normalizeSource(value) {
  const source = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!source) return 'direct';
  return SOURCES.has(source) ? source : 'other';
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

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    .trim();
  return (
    forwarded ||
    String(req.headers['x-real-ip'] ?? '').trim() ||
    String(req.socket?.remoteAddress ?? '').trim() ||
    'unknown'
  ).slice(0, 200);
}

function requestFingerprint(req) {
  const secret = String(process.env.SUPABASE_SECRET_KEY ?? '');
  if (!secret) throw new Error('Server preregistration key is unavailable');
  return createHmac('sha256', secret)
    .update(`novelight-beta-author-preregistration:${clientIp(req)}`)
    .digest('hex');
}

function bodyObject(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.length <= 20_000) {
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

async function loadCampaign() {
  const { data, error } = await supabase
    .from('beta_author_preregistration_config')
    .select('state,release_label,updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  if (!data || !STATES.has(data.state)) {
    throw new Error('Preregistration campaign config is unavailable');
  }
  return data;
}

function publicReleaseLabel(value) {
  const releaseLabel = String(value ?? '').trim();
  if (!releaseLabel || releaseLabel === LEGACY_RELEASE_LABEL) {
    return BETA_RELEASE_LABEL;
  }
  return releaseLabel;
}

function publicCampaign(campaign) {
  return {
    state: campaign.state,
    releaseLabel: publicReleaseLabel(campaign.release_label)
  };
}

function publicError(error) {
  const message = String(error?.message ?? '');
  if (message.includes('受付は現在行っていません')) {
    return { status: 409, code: 'REGISTRATION_CLOSED' };
  }
  if (message.includes('短時間に送信できる回数')) {
    return { status: 429, code: 'RATE_LIMITED' };
  }
  if (message.includes('メールアドレス')) {
    return { status: 400, code: 'INVALID_EMAIL' };
  }
  if (
    error?.code === '22023' ||
    message.includes('ペンネーム') ||
    message.includes('作品URL') ||
    message.includes('コメント') ||
    message.includes('同意')
  ) {
    return { status: 400, code: 'INVALID_INPUT' };
  }
  return { status: 500, code: 'REGISTRATION_FAILED' };
}

async function register(req, body) {
  const fingerprint = requestFingerprint(req);
  const { data, error } = await supabase.rpc(
    'submit_beta_author_preregistration',
    {
      p_pen_name: String(body.pen_name ?? ''),
      p_email: String(body.email ?? ''),
      p_x_account: String(body.x_account ?? ''),
      p_work_url: String(body.work_url ?? ''),
      p_genre: String(body.genre ?? ''),
      p_comment: String(body.comment ?? ''),
      p_consent: body.consent === true,
      p_source: normalizeSource(body.source),
      p_visitor_token: fingerprint,
      p_website: String(body.website ?? '')
    }
  );
  if (error) throw error;
  if (!['registered', 'duplicate'].includes(data)) {
    throw new Error('Unexpected preregistration result');
  }
  return data;
}

async function recordEvent(req, body) {
  const eventType = String(body.event_type ?? '')
    .trim()
    .toLowerCase();
  if (!EVENT_TYPES.has(eventType)) {
    const error = new Error('Unsupported preregistration event');
    error.code = 'INVALID_EVENT';
    throw error;
  }
  const fingerprint = requestFingerprint(req);
  const { data, error } = await supabase.rpc(
    'record_beta_author_preregistration_event',
    {
      p_event_type: eventType,
      p_source: normalizeSource(body.source),
      p_visitor_token: fingerprint
    }
  );
  if (error) throw error;
  return data === true;
}

export default async function handler(req, res) {
  setPrivateResponseHeaders(res);

  if (req.method === 'GET') {
    try {
      const campaign = await loadCampaign();
      return res.status(200).json({ campaign: publicCampaign(campaign) });
    } catch (error) {
      console.error('NOVELIGHT preregistration campaign lookup failed', error);
      return res.status(503).json({ error: 'CAMPAIGN_UNAVAILABLE' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  if (!isSameOriginRequest(req)) {
    return res.status(403).json({ error: 'ORIGIN_REJECTED' });
  }

  const body = bodyObject(req);
  if (!body) return res.status(400).json({ error: 'INVALID_REQUEST' });

  try {
    if (body.action === 'register') {
      const result = await register(req, body);
      return res.status(200).json({ result });
    }
    if (body.action === 'event') {
      const accepted = await recordEvent(req, body);
      return res.status(200).json({ accepted });
    }
    return res.status(400).json({ error: 'INVALID_ACTION' });
  } catch (error) {
    if (error?.code === 'INVALID_EVENT') {
      return res.status(400).json({ error: 'INVALID_EVENT' });
    }
    const mapped = publicError(error);
    if (mapped.status >= 500) {
      console.error('NOVELIGHT beta author preregistration failed', error);
    }
    return res.status(mapped.status).json({ error: mapped.code });
  }
}
