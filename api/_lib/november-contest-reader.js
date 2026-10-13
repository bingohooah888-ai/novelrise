import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';
import { URL } from 'node:url';
import { isIP } from 'node:net';

const CONTEST_KEY = 'novelight-november-2026';
const COOKIE_NAME = '__Host-novelight-contest-guest';
const COOKIE_AGE_SECONDS = 60 * 60 * 24 * 60;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MIN_SECRET_BYTES = 32;
const MAX_BODY_BYTES = 1024;

function jsonError(res, status, code) {
  return res.status(status).json({ ok: false, error: code });
}

function requestOriginAllowed(req, allowedOrigin) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (typeof origin !== 'string' || typeof host !== 'string') return false;
  try {
    const allowed = new URL(allowedOrigin);
    return (
      allowed.protocol === 'https:' &&
      allowed.origin === origin &&
      allowed.host === host
    );
  } catch {
    return false;
  }
}

function parseBody(req) {
  let raw;
  if (typeof req.body === 'string') {
    raw = req.body;
  } else if (
    req.body &&
    typeof req.body === 'object' &&
    !Array.isArray(req.body)
  ) {
    raw = JSON.stringify(req.body);
  } else {
    return null;
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function cookieFromHeader(value) {
  if (typeof value !== 'string') return null;
  const matches = value
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(COOKIE_NAME + '='));
  if (matches.length > 1) return { invalid: true };
  return matches.length
    ? { value: matches[0].slice(COOKIE_NAME.length + 1) }
    : null;
}

function signature(secret, token, expires) {
  return createHmac('sha256', secret)
    .update('novelight:november:guest:v1:' + token + ':' + expires)
    .digest('base64url');
}

function signedCookie(secret, nowMs) {
  const token = randomBytes(32).toString('base64url');
  const expires = Math.floor(nowMs / 1000) + COOKIE_AGE_SECONDS;
  return {
    token,
    value: ['v1', token, expires, signature(secret, token, expires)].join('.')
  };
}

function verifyCookie(value, secret, nowMs) {
  if (!value || value.length > 250) return null;
  const parts = value.split('.');
  if (
    parts.length !== 4 ||
    parts[0] !== 'v1' ||
    !GUEST_TOKEN.test(parts[1]) ||
    !/^[0-9]{10}$/.test(parts[2]) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[3])
  )
    return null;
  const expires = Number(parts[2]);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (expires <= nowSeconds || expires > nowSeconds + COOKIE_AGE_SECONDS) {
    return null;
  }
  const expected = Buffer.from(signature(secret, parts[1], parts[2]), 'utf8');
  const received = Buffer.from(parts[3], 'utf8');
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }
  return parts[1];
}

function trustedClientIp(req) {
  // Only the trusted Vercel-managed header is accepted. Never accept
  // arbitrary body/query/X-Forwarded-For values as a guest quota identity.
  const value = req.headers?.['x-vercel-forwarded-for'];
  if (typeof value !== 'string') return null;
  const addresses = value.split(',').map((entry) => entry.trim());
  return addresses.length === 1 && isIP(addresses[0]) ? addresses[0] : null;
}

function visitorRateHash(secret, ip) {
  return createHmac('sha256', secret)
    .update('novelight:november:guest-ip:v1:' + ip)
    .digest('hex');
}

function guestHash(token) {
  return createHash('sha256')
    .update('novelight:november:guest:v1:' + token)
    .digest('hex');
}

async function findIdentity(db, contestId, kind, value) {
  let query = db
    .from('novelight_contest_readers')
    .select('id,review_status')
    .eq('contest_id', contestId);
  query =
    kind === 'account'
      ? query.eq('user_id', value)
      : query.eq('guest_key_hash', value);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function resolveIdentity(db, contestId, kind, value) {
  const current = await findIdentity(db, contestId, kind, value);
  if (current) return current;
  const fields =
    kind === 'account'
      ? { kind, contest_id: contestId, user_id: value }
      : { kind, contest_id: contestId, guest_key_hash: value };
  const inserted = await db
    .from('novelight_contest_readers')
    .insert(fields)
    .select('id,review_status')
    .single();
  if (inserted.error?.code === '23505') {
    const concurrent = await findIdentity(db, contestId, kind, value);
    if (concurrent) return concurrent;
  }
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

function validAction(body) {
  if (body.action === 'start') {
    return (
      Number.isSafeInteger(body.episode_id) &&
      body.episode_id > 0 &&
      ['scroll', 'tts'].includes(body.mode)
    );
  }
  if (body.action === 'heartbeat') {
    return (
      typeof body.session_id === 'string' &&
      UUID.test(body.session_id) &&
      Number.isSafeInteger(body.sequence) &&
      body.sequence > 0 &&
      body.sequence <= 1000 &&
      typeof body.progress_ratio === 'number' &&
      Number.isFinite(body.progress_ratio) &&
      body.progress_ratio >= 0 &&
      body.progress_ratio <= 1 &&
      typeof body.foreground === 'boolean' &&
      typeof body.interacted === 'boolean'
    );
  }
  return false;
}

function authToken(header) {
  if (header === undefined) return null;
  if (typeof header !== 'string') return false;
  const match = /^Bearer ([^\s]{1,4096})$/.exec(header);
  return match ? match[1] : false;
}

export function createNovemberContestReaderHandler({
  serviceClient,
  guestSecret,
  enabled = false,
  allowedOrigin = 'https://novelight.jp',
  now = () => Date.now()
}) {
  const secretIsValid =
    typeof guestSecret === 'string' &&
    Buffer.byteLength(guestSecret, 'utf8') >= MIN_SECRET_BYTES;

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Vary', 'Origin, Cookie, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    // No user data or Supabase RPC access until an independent launch gate
    // enables this API. New secret deployment and opening require approval.
    if (!enabled || !secretIsValid || !serviceClient) {
      return jsonError(res, 503, 'CONTEST_READING_DISABLED');
    }
    if (req.method !== 'POST') return jsonError(res, 405, 'METHOD_NOT_ALLOWED');
    if (!requestOriginAllowed(req, allowedOrigin)) {
      return jsonError(res, 403, 'ORIGIN_REJECTED');
    }
    const body = parseBody(req);
    if (
      !body ||
      !validAction(body) ||
      'reader_id' in body ||
      'contest_id' in body
    ) {
      return jsonError(res, 400, 'INVALID_REQUEST');
    }

    try {
      const nowMs = now();
      const contestResponse = await serviceClient
        .from('novelight_contests')
        .select('id,status,public_visible,starts_at,ends_at')
        .eq('contest_key', CONTEST_KEY)
        .maybeSingle();
      if (contestResponse.error) throw contestResponse.error;
      const contest = contestResponse.data;
      if (
        !contest ||
        contest.status !== 'active' ||
        contest.public_visible !== true ||
        !(
          Date.parse(contest.starts_at) <= nowMs &&
          nowMs < Date.parse(contest.ends_at)
        )
      ) {
        return jsonError(res, 404, 'CONTEST_NOT_ACTIVE');
      }

      const authorization = authToken(req.headers?.authorization);
      if (authorization === false) return jsonError(res, 401, 'UNAUTHORIZED');

      let kind;
      let identifier;
      let newCookie = null;
      if (authorization) {
        const auth = await serviceClient.auth.getUser(authorization);
        if (auth.error || !UUID.test(String(auth.data?.user?.id ?? ''))) {
          return jsonError(res, 401, 'UNAUTHORIZED');
        }
        kind = 'account';
        identifier = auth.data.user.id;
      } else {
        const rawCookie = cookieFromHeader(req.headers?.cookie);
        if (rawCookie?.invalid) {
          return jsonError(res, 401, 'INVALID_GUEST_COOKIE');
        }
        if (!rawCookie && body.action !== 'start') {
          return jsonError(res, 401, 'GUEST_SESSION_REQUIRED');
        }
        let token = rawCookie?.value
          ? verifyCookie(rawCookie.value, guestSecret, nowMs)
          : null;
        if (rawCookie && !token) {
          return jsonError(res, 401, 'INVALID_GUEST_COOKIE');
        }
        if (!token) {
          const ip = trustedClientIp(req);
          if (!ip) return jsonError(res, 503, 'GUEST_ISSUANCE_UNAVAILABLE');
          const quota = await serviceClient.rpc(
            'novelight_contest_guest_creation_slot',
            { p_fingerprint: visitorRateHash(guestSecret, ip) }
          );
          if (quota.error) throw quota.error;
          if (quota.data !== true) {
            return jsonError(res, 429, 'GUEST_CREATION_LIMIT');
          }
          const minted = signedCookie(guestSecret, nowMs);
          token = minted.token;
          newCookie =
            COOKIE_NAME +
            '=' +
            minted.value +
            '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' +
            COOKIE_AGE_SECONDS;
        }
        kind = 'guest';
        identifier = guestHash(token);
      }

      const reader = await resolveIdentity(
        serviceClient,
        contest.id,
        kind,
        identifier
      );
      if (
        !reader ||
        !['provisional', 'cleared'].includes(reader.review_status)
      ) {
        return jsonError(res, 403, 'READER_UNAVAILABLE');
      }
      if (newCookie) res.setHeader('Set-Cookie', newCookie);

      if (body.action === 'start') {
        const result = await serviceClient.rpc(
          'novelight_contest_begin_read_session',
          {
            p_reader_id: reader.id,
            p_episode_id: body.episode_id,
            p_mode: body.mode
          }
        );
        if (result.error) throw result.error;
        if (result.data?.ok !== true) {
          return res
            .status(200)
            .json({ ok: false, reason: result.data?.reason || 'rejected' });
        }
        return res.status(200).json({
          ok: true,
          session_id: result.data.session_id,
          reading_mode: result.data.reading_mode,
          provisional_only: true
        });
      }

      // This check is intentionally repeated by the service-only heartbeat
      // RPC: one browser can never submit another reader's session ID.
      const owned = await serviceClient
        .from('novelight_contest_read_sessions')
        .select('id')
        .eq('id', body.session_id)
        .eq('contest_id', contest.id)
        .eq('reader_id', reader.id)
        .maybeSingle();
      if (owned.error) throw owned.error;
      if (!owned.data) return jsonError(res, 404, 'SESSION_NOT_FOUND');

      const beat = await serviceClient.rpc(
        'novelight_contest_heartbeat_read_session',
        {
          p_session_id: body.session_id,
          p_reader_id: reader.id,
          p_sequence: body.sequence,
          p_progress_ratio: body.progress_ratio,
          p_foreground: body.foreground,
          p_interacted: body.interacted
        }
      );
      if (beat.error) throw beat.error;
      if (beat.data?.ok !== true) {
        return res
          .status(200)
          .json({ ok: false, reason: beat.data?.reason || 'rejected' });
      }

      if (beat.data.qualified === true) {
        const credited = await serviceClient.rpc(
          'novelight_contest_record_qualified_session',
          { p_session_id: body.session_id }
        );
        if (credited.error) throw credited.error;
        return res.status(200).json({
          ok: credited.data?.ok === true,
          qualified: true,
          provisional_only: true,
          recorded: credited.data?.ok === true
        });
      }
      return res.status(200).json({
        ok: true,
        qualified: false,
        provisional_only: true
      });
    } catch {
      // Never log bearer tokens, cookies, visitor IPs or identifiers.
      console.error('NOVELIGHT contest read session unavailable');
      return jsonError(res, 503, 'CONTEST_READING_UNAVAILABLE');
    }
  };
}
