const PRODUCTION_APP_URL = 'https://novelrise.vercel.app';
const PRODUCTION_HOST = 'novelrise.vercel.app';

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
    parsed.hostname === PRODUCTION_HOST
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

  return (env.NOVELIGHT_APP_URL || PRODUCTION_APP_URL).replace(/\/+$/, '');
}
