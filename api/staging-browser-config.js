const PRODUCTION_SUPABASE_HOST = 'fiepaguycecrredwrcwx.supabase.co';

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

function normalizePublishableKey(value) {
  if (!value) return null;
  if (value.startsWith('sb_publishable_')) return value;
  if (value.startsWith('sb_secret_')) return null;

  if (value.startsWith('eyJ') && decodeJwtRole(value) === 'anon') {
    return value;
  }

  return null;
}

export function buildStagingBrowserConfig(env = process.env) {
  if (env.VERCEL_ENV !== 'preview') return null;

  const supabaseUrl = normalizeSupabaseUrl(env.SUPABASE_URL);
  const supabasePublishableKey = normalizePublishableKey(
    env.SUPABASE_PUBLISHABLE_KEY
  );

  if (!supabaseUrl || !supabasePublishableKey) return null;

  return {
    supabaseUrl,
    supabasePublishableKey
  };
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const config = buildStagingBrowserConfig();
  if (!config) {
    return res.status(404).json({ error: 'Not found' });
  }

  return res.status(200).json(config);
}
