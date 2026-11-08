import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ACCOUNT = new URL('https://api.stripe.com/v1/account');
const PRICES = new URL('https://api.stripe.com/v1/prices');
PRICES.searchParams.set('active', 'true');
PRICES.searchParams.set('limit', '20');
PRICES.searchParams.append('lookup_keys[]', 'novelight_standard_monthly_jpy');
PRICES.searchParams.append('lookup_keys[]', 'novelight_premium_beta_2026_monthly_jpy');

const LOOKUPS = Object.freeze({
  standard: 'novelight_standard_monthly_jpy',
  premiumBeta: 'novelight_premium_beta_2026_monthly_jpy'
});

const HTTP = Object.freeze({
  unrequested: 'NOT_REQUESTED',
  invalid: 'INVALID_RESPONSE',
  network: 'NETWORK_FAILURE'
});

// The only permitted result properties are match, counts, and broad statuses.
// Account IDs, API keys, Stripe object IDs, response bodies and raw errors
// must never be written to stdout, stderr, files or GitHub Actions outputs.
function result(accountMatch = null, standard = null, premiumBeta = null,
                accountStatus = HTTP.unrequested, pricesStatus = HTTP.unrequested) {
  return Object.freeze({
    accountMatch, standardCount: standard, premiumBetaCount: premiumBeta,
    accountStatus, pricesStatus
  });
}

export function httpClass(status) {
  if (!Number.isSafeInteger(status)) return 'HTTP_UNKNOWN';
  if (status >= 200 && status < 300) return 'HTTP_2XX';
  if (status === 401) return 'HTTP_401';
  if (status === 403) return 'HTTP_403';
  if (status === 404) return 'HTTP_404';
  if (status === 429) return 'HTTP_429';
  if (status >= 400 && status < 500) return 'HTTP_4XX';
  if (status >= 500 && status < 600) return 'HTTP_5XX';
  return 'HTTP_OTHER';
}

function isTestServerKey(value) {
  return typeof value === 'string' &&
    /^(?:sk_test_|rk_test_)[A-Za-z0-9_]{12,}$/u.test(value);
}

function validExpectedDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

async function stripeRead(url, key, fetchImpl) {
  // HTTPS host, method and path are immutable; no redirects or write API calls.
  const safe = url.toString();
  if (url.origin !== 'https://api.stripe.com' ||
      !['/v1/account', '/v1/prices'].includes(url.pathname)) {
    throw new Error('DIAGNOSTIC_ENDPOINT_FORBIDDEN');
  }
  try {
    const response = await fetchImpl(safe, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + key },
      redirect: 'error',
      signal: AbortSignal.timeout(12000)
    });
    const status = httpClass(response?.status);
    if (!response?.ok || status !== 'HTTP_2XX') {
      // Do not read or print Stripe's error body.
      return { status, value: null };
    }
    let json;
    try {
      json = await response.json();
    } catch {
      return { status: HTTP.invalid, value: null };
    }
    return { status, value: json };
  } catch {
    // Never log the exception: fetch errors can include headers or URLs.
    return { status: HTTP.network, value: null };
  }
}

export async function inspectStripeTestSandbox({
  key,
  expectedAccountSha256,
  fetchImpl = globalThis.fetch
}) {
  if (!isTestServerKey(key) || !validExpectedDigest(expectedAccountSha256) ||
      typeof fetchImpl !== 'function') {
    return result(null, null, null, 'INVALID_CONFIGURATION', HTTP.unrequested);
  }
  const account = await stripeRead(ACCOUNT, key, fetchImpl);
  if (!account.value) return result(null, null, null, account.status);

  const id = account.value?.id;
  if (account.value?.object !== 'account' ||
      typeof id !== 'string' || !/^acct_[A-Za-z0-9]{8,}$/u.test(id)) {
    return result(null, null, null, HTTP.invalid);
  }
  const actual = createHash('sha256').update(id, 'utf8').digest();
  const expected = Buffer.from(expectedAccountSha256, 'hex');
  const matched = timingSafeEqual(actual, expected);
  // Mismatched account? Never even look up its prices.
  if (!matched) return result(false, null, null, account.status);

  const prices = await stripeRead(PRICES, key, fetchImpl);
  if (!prices.value) return result(true, null, null, account.status, prices.status);
  const data = prices.value;
  if (data?.object !== 'list' || data?.has_more !== false ||
      !Array.isArray(data.data) || data.data.length > 20 ||
      data.data.some(p => p?.object !== 'price' ||
        p.active !== true || p.livemode !== false ||
        !Object.values(LOOKUPS).includes(p.lookup_key))) {
    return result(true, null, null, account.status, HTTP.invalid);
  }
  const count = (lookup) => data.data.filter(p => p.lookup_key === lookup).length;
  return result(true, count(LOOKUPS.standard), count(LOOKUPS.premiumBeta),
                account.status, prices.status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  inspectStripeTestSandbox({
    key: process.env.STRIPE_TEST_SECRET_KEY,
    expectedAccountSha256: process.env.STRIPE_TEST_EXPECTED_ACCOUNT_SHA256
  }).then(out => {
    console.log('STRIPE_TEST_IDENTITY_READONLY ' + JSON.stringify(out));
    if (out.accountMatch !== true || out.pricesStatus !== 'HTTP_2XX') {
      process.exitCode = 1;
    }
  }).catch(() => {
    // No raw exceptions may enter GitHub logs.
    console.log('STRIPE_TEST_IDENTITY_READONLY ' +
      JSON.stringify(result(null, null, null, HTTP.network)));
    process.exitCode = 1;
  });
}
