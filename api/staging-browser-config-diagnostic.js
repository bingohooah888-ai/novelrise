const PRODUCTION_SUPABASE_HOST = 'fiepaguycecrredwrcwx.supabase.co';

function inspectStagingSupabaseUrl(value) {
  const result = {
    present: Boolean(value),
    hasLeadingOrTrailingWhitespace: false,
    quoted: false,
    parseable: false,
    parseableAfterTrim: false,
    parseableAfterUnquoteAndTrim: false,
    https: false,
    noEmbeddedCredentials: false,
    supabaseHost: false,
    nonProductionHost: false,
    valid: false
  };

  if (!value) return result;

  const trimmed = value.trim();
  result.hasLeadingOrTrailingWhitespace = trimmed !== value;
  result.quoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")));

  try {
    new globalThis.URL(trimmed);
    result.parseableAfterTrim = true;
  } catch {}

  const unquoted = result.quoted ? trimmed.slice(1, -1).trim() : trimmed;
  try {
    new globalThis.URL(unquoted);
    result.parseableAfterUnquoteAndTrim = true;
  } catch {}

  try {
    const parsed = new globalThis.URL(value);
    result.parseable = true;
    result.https = parsed.protocol === 'https:';
    result.noEmbeddedCredentials = !parsed.username && !parsed.password;
    result.supabaseHost = parsed.hostname.endsWith('.supabase.co');
    result.nonProductionHost = parsed.hostname !== PRODUCTION_SUPABASE_HOST;
    result.valid =
      result.https &&
      result.noEmbeddedCredentials &&
      result.supabaseHost &&
      result.nonProductionHost;
    return result;
  } catch {
    return result;
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

  const supabaseUrl = inspectStagingSupabaseUrl(
    process.env.NOVELIGHT_STAGING_SUPABASE_URL
  );

  return res.status(200).json({
    previewEnvironment: process.env.VERCEL_ENV === 'preview',
    hasValidStagingSupabaseUrl: supabaseUrl.valid,
    supabaseUrl,
    hasValidPublishableKey: hasValidPublishableKey(
      process.env.NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY
    )
  });
}
