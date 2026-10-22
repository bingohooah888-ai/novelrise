// Read-only, trusted-main gate before any browser session touches a Preview.
// Never log a publishable key or candidate response body.
const STAGING_URL = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const PROD_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
const PROD_HOST = 'novelrise.vercel.app';

function fail(reason) {
  throw new Error('COMMUNITY_PREVIEW_BROWSER_DENIED: ' + reason);
}

export function assertPreviewBrowserBoundary({ origin, expectedUrl, expectedKey, config }) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail('invalid Preview URL');
  }
  if (parsed.protocol !== 'https:' ||
      !parsed.hostname.endsWith('.vercel.app') ||
      parsed.hostname === PROD_HOST ||
      parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    fail('Preview target must be a dedicated non-Production origin');
  }
  if (expectedUrl !== STAGING_URL || expectedUrl === PROD_URL) {
    fail('unexpected dedicated Staging identity');
  }
  if (typeof expectedKey !== 'string' || expectedKey.length < 20) {
    fail('Staging publishable key not configured');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      Object.keys(config).sort().join(',') !==
        'supabasePublishableKey,supabaseUrl') {
    fail('browser config fields changed');
  }
  if (config.supabaseUrl !== STAGING_URL ||
      config.supabasePublishableKey !== expectedKey) {
    fail('browser-side connection does not match exact Staging');
  }
  if (expectedKey.startsWith('sb_secret_') ||
      expectedKey.startsWith('sk_')) {
    fail('secret-class key cannot reach browser');
  }
  const modern = expectedKey.startsWith('sb_publishable_');
  let legacyAnon = false;
  if (!modern && expectedKey.startsWith('eyJ')) {
    try {
      const [, token] = expectedKey.split('.');
      const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
      legacyAnon = decoded.role === 'anon';
    } catch {
      legacyAnon = false;
    }
  }
  if (!modern && !legacyAnon) fail('browser key is not publishable/anon');
  return Object.freeze({ origin: parsed.origin, stagingUrl: STAGING_URL });
}

export async function checkPreviewBrowserBoundary(env = process.env, request = fetch) {
  const origin = env.CANONICAL_STAGING_URL;
  const expectedUrl = env.STAGING_EXPECTED_SUPABASE_URL;
  const expectedKey = env.STAGING_EXPECTED_PUBLISHABLE_KEY;
  // Check target and key class before making any HTTP request.
  const validated = assertPreviewBrowserBoundary({
    origin, expectedUrl, expectedKey,
    config: { supabaseUrl: expectedUrl, supabasePublishableKey: expectedKey }
  });
  if (!env.VERCEL_AUTOMATION_BYPASS_SECRET) fail('Preview protection bypass missing');

  const response = await request(validated.origin + '/api/staging-browser-config', {
    method: 'GET',
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET
    },
    signal: AbortSignal.timeout(20000)
  });
  if (response.status !== 200 ||
      !String(response.headers?.get?.('content-type') ?? '')
        .toLowerCase().includes('application/json')) {
    fail('browser config endpoint unavailable or protected');
  }
  let config;
  try {
    config = await response.json();
  } catch {
    fail('invalid browser config JSON');
  }
  return assertPreviewBrowserBoundary({ origin, expectedUrl, expectedKey, config });
}

if (process.argv[2] === 'verify') {
  checkPreviewBrowserBoundary().then(
    ({ origin }) => console.log('Preview browser Staging binding verified:', origin),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    }
  );
}
