const PRODUCTION_SUPABASE_HOST = 'fiepaguycecrredwrcwx.supabase.co';

function hasValidStagingSupabaseUrl(value) {
  if (!value) return false;

  try {
    const parsed = new globalThis.URL(value);
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      parsed.hostname.endsWith('.supabase.co') &&
      parsed.hostname !== PRODUCTION_SUPABASE_HOST
    );
  } catch {
    return false;
  }
}

function hasValidPublishableKey(value) {
  if (!value) return false;
  if (value.startsWith('sb_publishable_')) return true;
  if (value.startsWith('sb_secret_')) return false;

  if (!value.startsWith('eyJ')) return false;

  try {
    const [, encodedPayload] = value.split('.');
    if (!encodedPayload) return false;
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    );
    return payload?.role === 'anon';
  } catch {
    return false;
  }
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({
    previewEnvironment: process.env.VERCEL_ENV === 'preview',
    hasValidStagingSupabaseUrl: hasValidStagingSupabaseUrl(
      process.env.SUPABASE_URL
    ),
    hasValidPublishableKey: hasValidPublishableKey(
      process.env.SUPABASE_PUBLISHABLE_KEY
    )
  });
}
