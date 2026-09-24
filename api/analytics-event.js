import { createHmac } from 'node:crypto';
import { URL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

function firstHeader(value) {
  return String(value ?? '')
    .split(',')[0]
    .trim();
}

function requestHost(req) {
  return (
    firstHeader(req.headers['x-forwarded-host']) ||
    firstHeader(req.headers.host)
  );
}

function isSameOriginRequest(req) {
  const origin = String(req.headers.origin ?? '').trim();
  const host = requestHost(req);
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function clientIp(req) {
  return (
    firstHeader(req.headers['x-vercel-forwarded-for']) ||
    firstHeader(req.headers['x-forwarded-for']) ||
    firstHeader(req.headers['x-real-ip']) ||
    String(req.socket?.remoteAddress ?? '').trim() ||
    'unknown'
  ).slice(0, 200);
}

export function resolveAnalyticsFingerprintSecret(value, supabaseSecret) {
  const fingerprintSecret = String(value ?? '');
  if (Buffer.byteLength(fingerprintSecret, 'utf8') < 32) {
    throw new Error('Analytics fingerprint secret is unavailable or too short');
  }
  if (fingerprintSecret === supabaseSecret) {
    throw new Error('Analytics fingerprint secret must be purpose-specific');
  }
  return fingerprintSecret;
}

function requestFingerprint(req, fingerprintSecret) {
  return createHmac('sha256', fingerprintSecret)
    .update(`novelight-public-analytics:${clientIp(req)}`)
    .digest('hex');
}

function bearerToken(authorization) {
  const match =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;
  return match?.[1] ?? null;
}

function bodyObject(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.length <= 10_000) {
    try {
      const parsed = JSON.parse(req.body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function optionalString(value) {
  return value === null || value === undefined ? null : String(value);
}

function isRateLimit(error) {
  return (
    error?.code === 'P0001' &&
    /limit|too many/i.test(String(error?.message ?? ''))
  );
}

export function createAnalyticsEventHandler({
  serviceClient,
  createAuthenticatedClient,
  fingerprintRequest
}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: 'ORIGIN_REJECTED' });
    }

    const body = bodyObject(req);
    if (!body) return res.status(400).json({ error: 'INVALID_REQUEST' });

    try {
      const token = bearerToken(req.headers.authorization);
      let authenticatedClient = null;
      if (req.headers.authorization && !token) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }
      if (token) {
        const { data, error } = await serviceClient.auth.getUser(token);
        if (error || !data?.user) {
          return res.status(401).json({ error: 'UNAUTHORIZED' });
        }
        authenticatedClient = createAuthenticatedClient(token);
      }

      const fingerprint = fingerprintRequest(req);
      if (body.action === 'acquisition') {
        const { data, error } = await serviceClient.rpc(
          'record_acquisition_touch',
          {
            p_visitor_token: fingerprint,
            p_source: String(body.source ?? ''),
            p_medium: optionalString(body.medium),
            p_campaign: optionalString(body.campaign),
            p_content: optionalString(body.content),
            p_landing_path: String(body.landing_path ?? '/'),
            p_referrer_host: optionalString(body.referrer_host)
          }
        );
        if (error) throw error;
        if (authenticatedClient) {
          const claim = await authenticatedClient.rpc(
            'claim_user_acquisition',
            {
              p_visitor_token: fingerprint
            }
          );
          if (claim.error) throw claim.error;
        }
        return res.status(200).json({ accepted: Boolean(data) });
      }

      if (body.action === 'visit') {
        const client = authenticatedClient || serviceClient;
        const { data, error } = await client.rpc('record_beta_visit', {
          p_visitor_token: fingerprint,
          p_path: String(body.path ?? '/'),
          p_source: String(body.source ?? 'direct')
        });
        if (error) throw error;
        return res.status(200).json({ accepted: data === true });
      }

      if (body.action === 'journey') {
        const client = authenticatedClient || serviceClient;
        const { data, error } = await client.rpc(
          'record_reader_journey_event',
          {
            p_event_type: String(body.event_type ?? ''),
            p_novel_id: String(body.novel_id ?? ''),
            p_episode_id: optionalString(body.episode_id),
            p_visitor_token: fingerprint,
            p_source: String(body.source ?? 'direct')
          }
        );
        if (error) throw error;
        return res.status(200).json({ accepted: data === true });
      }

      if (body.action === 'episode-pv') {
        const client = authenticatedClient || serviceClient;
        const { data, error } = await client.rpc('record_episode_pv', {
          p_episode_id: String(body.episode_id ?? ''),
          p_visitor_token: fingerprint
        });
        if (error) throw error;
        return res.status(200).json({ accepted: data === true });
      }

      if (body.action === 'neutral-search-impressions') {
        const client = authenticatedClient || serviceClient;
        const novelIds = Array.isArray(body.novel_ids)
          ? body.novel_ids.slice(0, 51).map(String)
          : null;
        const { data, error } = await client.rpc(
          'record_neutral_search_impressions',
          {
            p_novel_ids: novelIds,
            p_visitor_token: fingerprint
          }
        );
        if (error) throw error;
        return res.status(200).json({
          accepted: Number(data) > 0,
          recorded_count: Number(data) || 0
        });
      }

      if (body.action === 'claim') {
        if (!authenticatedClient) {
          return res.status(401).json({ error: 'UNAUTHORIZED' });
        }
        const { data, error } = await authenticatedClient.rpc(
          'claim_user_acquisition',
          { p_visitor_token: fingerprint }
        );
        if (error) throw error;
        return res.status(200).json({ accepted: data === true });
      }

      return res.status(400).json({ error: 'INVALID_ACTION' });
    } catch (error) {
      if (isRateLimit(error)) {
        return res.status(200).json({ accepted: false });
      }
      if (error?.code === '22023') {
        return res.status(400).json({ error: 'INVALID_INPUT' });
      }
      console.error('NOVELIGHT public analytics event failed', {
        code: error?.code || null,
        message: error?.message || null
      });
      return res.status(503).json({ error: 'ANALYTICS_UNAVAILABLE' });
    }
  };
}

let productionHandler;

export default function handler(req, res) {
  try {
    if (!productionHandler) {
      const url = process.env.SUPABASE_URL;
      const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
      const fingerprintSecret = resolveAnalyticsFingerprintSecret(
        process.env.NOVELIGHT_ANALYTICS_FINGERPRINT_SECRET,
        supabaseSecret
      );
      const options = {
        auth: { autoRefreshToken: false, persistSession: false }
      };
      const serviceClient = createClient(url, supabaseSecret, options);
      productionHandler = createAnalyticsEventHandler({
        serviceClient,
        createAuthenticatedClient(token) {
          return createClient(url, supabaseSecret, {
            ...options,
            global: { headers: { Authorization: `Bearer ${token}` } }
          });
        },
        fingerprintRequest(req) {
          return requestFingerprint(req, fingerprintSecret);
        }
      });
    }
  } catch {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    console.error('NOVELIGHT public analytics configuration is unavailable');
    return res.status(503).json({ error: 'ANALYTICS_UNAVAILABLE' });
  }
  return productionHandler(req, res);
}
