import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INSPECTION_ENDPOINT,
  SITES_ENDPOINT,
  REQUIRED_SCOPE,
  SearchConsoleError,
  inspectNovelightUrl,
  listNovelightProperties,
  runGscCli,
  validateInspectionUrl,
  validateSiteUrl
} from '../scripts/nlo-gsc-inspection.mjs';

const root = 'https://novelight.jp/';
const property = 'sc-domain:novelight.jp';

function mockResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
  };
}

test('Search Console scope is explicitly read-only', () => {
  assert.equal(
    REQUIRED_SCOPE,
    'https://www.googleapis.com/auth/webmasters.readonly'
  );
});

test('accepts only HTTPS URLs for NOVELIGHT and exact property identifiers', () => {
  assert.equal(validateInspectionUrl(root), root);
  assert.equal(
    validateInspectionUrl('https://novelight.jp/search.html?tag=SF'),
    'https://novelight.jp/search.html?tag=SF'
  );
  assert.equal(validateSiteUrl(property), property);
  assert.equal(validateSiteUrl(root), root);
  for (const value of [
    'http://novelight.jp/',
    'https://novelight.jp.evil.test/',
    'https://novelrise.vercel.app/',
    'https://novelight.jp:8443/',
    'https://someone@novelight.jp/',
    'https://novelight.jp/#secret'
  ]) {
    assert.throws(() => validateInspectionUrl(value), SearchConsoleError);
  }
  assert.throws(
    () => validateSiteUrl('https://novelight.jp/private'),
    SearchConsoleError
  );
});

test('requires authorized OAuth token before accessing the API', async () => {
  let attempted = false;
  await assert.rejects(
    inspectNovelightUrl({
      siteUrl: property,
      token: '',
      fetchImpl: async () => {
        attempted = true;
      }
    }),
    (error) => error.code === 'authorization_required'
  );
  assert.equal(attempted, false);
});

test('requests only the official inspection endpoint and reports PASS correctly', async () => {
  const token = 'SENSITIVE_ACCESS_TOKEN';
  let calls = 0;
  const result = await inspectNovelightUrl({
    token,
    siteUrl: property,
    fetchImpl: async (url, opts) => {
      calls += 1;
      assert.equal(url, INSPECTION_ENDPOINT);
      assert.equal(opts.method, 'POST');
      assert.equal(opts.headers.Authorization, 'Bearer ' + token);
      assert.deepEqual(JSON.parse(opts.body), {
        siteUrl: property,
        inspectionUrl: root,
        languageCode: 'ja-JP'
      });
      return mockResponse({
        inspectionResult: {
          inspectionResultLink: 'https://search.google.com/search-console/',
          indexStatusResult: {
            verdict: 'PASS',
            coverageState: 'Indexed, not submitted in sitemap',
            lastCrawlTime: '2026-10-11T12:00:00Z',
            googleCanonical: root,
            userCanonical: root,
            sitemap: ['https://novelight.jp/sitemap.xml']
          }
        }
      });
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.indexStatus, 'indexed');
  assert.equal(result.googleCanonical, root);
  assert.equal(result.lastCrawlTime, '2026-10-11T12:00:00Z');
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('NEUTRAL, FAIL, and unspecified verdicts are not mistaken for indexed', async () => {
  for (const [verdict, expected] of [
    ['NEUTRAL', 'not_indexed'],
    ['FAIL', 'not_indexed'],
    ['VERDICT_UNSPECIFIED', 'unknown']
  ]) {
    const data = await inspectNovelightUrl({
      token: 'TOKEN',
      siteUrl: root,
      fetchImpl: async () =>
        mockResponse({
          inspectionResult: {
            indexStatusResult: { verdict, coverageState: 'Discovered' }
          }
        })
    });
    assert.equal(data.indexStatus, expected);
  }
});

test('site discovery exposes only NOVELIGHT properties', async () => {
  const response = await listNovelightProperties({
    token: 'TOKEN',
    fetchImpl: async (url, options) => {
      assert.equal(url, SITES_ENDPOINT);
      assert.equal(options.method, 'GET');
      return mockResponse({
        siteEntry: [
          { siteUrl: 'sc-domain:novelight.jp', permissionLevel: 'siteOwner' },
          { siteUrl: 'https://novelight.jp/', permissionLevel: 'siteOwner' },
          { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' }
        ]
      });
    }
  });
  assert.deepEqual(response.properties, [
    { siteUrl: property, permissionLevel: 'siteOwner' },
    { siteUrl: root, permissionLevel: 'siteOwner' }
  ]);
});

test('401/403/429 errors do not expose Google or credential responses', async () => {
  for (const [code, expected] of [
    [401, 'authorization_failed'],
    [403, 'property_permission_denied'],
    [429, 'rate_limited']
  ]) {
    await assert.rejects(
      inspectNovelightUrl({
        token: 'SECRET_VALUE',
        siteUrl: property,
        fetchImpl: async () =>
          mockResponse({ error: { message: 'SECRET_VALUE' } }, code)
      }),
      (error) =>
        error.code === expected &&
        !JSON.stringify(error).includes('SECRET_VALUE')
    );
  }
});

test('absent indexStatusResult never generates a fabricated index state', async () => {
  await assert.rejects(
    inspectNovelightUrl({
      token: 'TOKEN',
      siteUrl: property,
      fetchImpl: async () => mockResponse({ inspectionResult: {} })
    }),
    (error) => error.code === 'inspection_data_unavailable'
  );
});

test('CLI supports site discovery and refuses unsupported actions', async () => {
  const sites = await runGscCli(['sites'], {
    token: 'TOKEN',
    fetchImpl: async () => mockResponse({ siteEntry: [] })
  });
  assert.deepEqual(sites, { status: 'ok', properties: [] });
  const help = await runGscCli(['--help'], { token: '' });
  assert.equal(help.status, 'help');
  await assert.rejects(
    runGscCli(['request-indexing'], { token: 'TOKEN' }),
    (error) => error.code === 'unsupported_command'
  );
});
