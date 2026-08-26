import { createHash } from 'node:crypto';

import { getAppBaseUrl } from './_lib/app-base-url.js';

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const PRODUCTION_SUPABASE_HOST = 'fiepaguycecrredwrcwx.supabase.co';

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeSupabaseUrl(value) {
  if (!value) return null;

  try {
    const parsed = new globalThis.URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname.endsWith('.supabase.co') ||
      parsed.hostname === PRODUCTION_SUPABASE_HOST
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function decodeJwtRole(value) {
  try {
    const [, encodedPayload] = value.split('.');
    if (!encodedPayload) return null;
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    );
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

function classifyPublishableKey(value) {
  if (!value) return 'missing';
  if (value.startsWith('sb_publishable_')) return 'publishable';
  if (value.startsWith('sb_secret_')) return 'secret';

  if (value.startsWith('eyJ')) {
    const role = decodeJwtRole(value);
    if (role === 'anon') return 'legacy-anon';
    if (role === 'service_role') return 'secret';
    return 'legacy-other';
  }

  return 'other';
}

function classifyStripeSecret(value) {
  if (!value) return 'missing';
  if (value.startsWith('sk_test_')) return 'test';
  if (value.startsWith('sk_live_')) return 'live';
  return 'other';
}

export function buildStagingEnvironmentFacts(env = process.env) {
  const publishableKeyClass = classifyPublishableKey(
    env.SUPABASE_PUBLISHABLE_KEY
  );
  const publishableKeyFingerprint = ['publishable', 'legacy-anon'].includes(
    publishableKeyClass
  )
    ? fingerprint(env.SUPABASE_PUBLISHABLE_KEY)
    : null;

  let appBaseUrl = null;
  try {
    appBaseUrl = getAppBaseUrl(env);
  } catch {
    appBaseUrl = null;
  }

  return {
    commitSha: COMMIT_PATTERN.test(env.VERCEL_GIT_COMMIT_SHA || '')
      ? env.VERCEL_GIT_COMMIT_SHA
      : null,
    vercelEnv: env.VERCEL_ENV || 'missing',
    appBaseUrl,
    supabase: {
      url: normalizeSupabaseUrl(env.SUPABASE_URL),
      publishableKeyClass,
      publishableKeyFingerprint,
      serverSecretPresent: Boolean(env.SUPABASE_SECRET_KEY)
    },
    stripe: {
      secretKeyMode: classifyStripeSecret(env.STRIPE_SECRET_KEY),
      standardPricePresent: Boolean(env.STRIPE_STANDARD_PRICE_ID),
      premiumPricePresent: Boolean(env.STRIPE_PREMIUM_PRICE_ID)
    }
  };
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.VERCEL_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  return res.status(200).json(buildStagingEnvironmentFacts());
}
