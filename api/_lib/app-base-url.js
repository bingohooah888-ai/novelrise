const PRODUCTION_APP_URL = 'https://novelight.jp';
// Keep the stable Vercel alias reserved as deployment infrastructure. It is
// never a user-facing canonical URL and must not be accepted as a Preview URL.
const VERCEL_PRODUCTION_HOST = 'novelrise.vercel.app';

function normalizePreviewUrl(value) {
  if (!value) {
    throw new Error('Preview app base URL is unavailable');
  }

  let parsed;
  try {
    parsed = new globalThis.URL(
      value.includes('://') ? value : `https://${value}`
    );
  } catch {
    throw new Error('Preview app base URL is invalid');
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname.endsWith('.vercel.app') ||
    parsed.hostname === VERCEL_PRODUCTION_HOST
  ) {
    throw new Error(
      'Preview app base URL is not an isolated Vercel deployment'
    );
  }

  return parsed.origin;
}

export function getAppBaseUrl(env = process.env) {
  if (env.VERCEL_ENV === 'preview') {
    return normalizePreviewUrl(env.VERCEL_URL);
  }

  const appUrl = (env.NOVELIGHT_APP_URL || PRODUCTION_APP_URL).replace(
    /\/+$/,
    ''
  );
  if (env.VERCEL_ENV === 'production' && appUrl !== PRODUCTION_APP_URL) {
    throw new Error('Production app base URL is not canonical');
  }

  return appUrl;
}
