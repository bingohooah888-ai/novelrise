import { buildStagingBrowserConfig } from '../staging-browser-config.js';

// Only the browser's public client is replaced. Never expose server secrets.
const PRODUCTION_SUPABASE_HOST = 'fiepaguycecrredwrcwx.supabase.co';
const PRODUCTION_CLIENT_PATTERN =
  /const client=supabase\.createClient\('https:\/\/fiepaguycecrredwrcwx\.supabase\.co','sb_publishable_[A-Za-z0-9_-]+'\);/gu;

function isolatedSupabaseOrigin(value) {
  if (typeof value !== 'string') return null;

  try {
    const url = new globalThis.URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !/^[a-z0-9-]+\.supabase\.co$/u.test(url.hostname) ||
      url.hostname === PRODUCTION_SUPABASE_HOST
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function scriptString(value) {
  // Avoid prematurely terminating the inline script even if config drifts.
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

/**
 * Production keeps the existing template byte-for-byte.
 * Preview is never allowed to return its template or query the database
 * unless the public browser target and the server-side target are the same
 * non-Production Staging project.
 */
export function prepareEpisodeReaderTemplate(template, env = process.env) {
  if (env.VERCEL_ENV === 'production') {
    return { html: template, preview: false };
  }

  if (env.VERCEL_ENV !== 'preview') {
    throw new Error('EPISODE_PREVIEW_ISOLATION_REQUIRED');
  }

  const config = buildStagingBrowserConfig(env);
  const serverOrigin = isolatedSupabaseOrigin(env.SUPABASE_URL);
  if (
    !config ||
    !serverOrigin ||
    serverOrigin !== config.supabaseUrl ||
    env.SUPABASE_PUBLISHABLE_KEY !== config.supabasePublishableKey ||
    typeof env.SUPABASE_SECRET_KEY !== 'string' ||
    !env.SUPABASE_SECRET_KEY.trim()
  ) {
    throw new Error('EPISODE_PREVIEW_SUPABASE_MISMATCH');
  }

  const occurrences = [...template.matchAll(PRODUCTION_CLIENT_PATTERN)];
  if (occurrences.length !== 1) {
    throw new Error('EPISODE_PREVIEW_TEMPLATE_DRIFT');
  }

  const replacement =
    'const client=supabase.createClient(' +
    scriptString(config.supabaseUrl) +
    ',' +
    scriptString(config.supabasePublishableKey) +
    ');';
  const html = template.replace(PRODUCTION_CLIENT_PATTERN, replacement);
  if (html.includes(PRODUCTION_SUPABASE_HOST)) {
    throw new Error('EPISODE_PREVIEW_PRODUCTION_REFERENCE');
  }

  return { html, preview: true };
}
