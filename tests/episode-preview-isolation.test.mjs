import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import episodeHandler from '../api/seo/episode.js';
import { prepareEpisodeReaderTemplate } from '../api/seo/episode-preview-isolation.js';

const originalTemplate = await readFile(
  new URL('../api/seo/templates/episode.html', import.meta.url),
  'utf8'
);
const STAGING_URL = 'https://safe-staging-fixture.supabase.co';
const PRODUCTION_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
const PUBLIC_KEY = 'sb_publishable_safe_fixture_key_for_tests';

function previewEnv(overrides = {}) {
  return {
    VERCEL_ENV: 'preview',
    SUPABASE_URL: STAGING_URL,
    NOVELIGHT_STAGING_SUPABASE_URL: STAGING_URL,
    SUPABASE_PUBLISHABLE_KEY: PUBLIC_KEY,
    NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY: PUBLIC_KEY,
    SUPABASE_SECRET_KEY: 'sb_secret_fixture_only_never_a_real_credential',
    ...overrides
  };
}

async function withEnvironment(env, callback) {
  const before = new Map();
  for (const [name, value] of Object.entries(env)) {
    before.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function response() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    }
  };
}

test('Production retains its original episode template and public client', () => {
  const result = prepareEpisodeReaderTemplate(originalTemplate, {
    VERCEL_ENV: 'production'
  });
  assert.equal(result.preview, false);
  assert.equal(result.html, originalTemplate);
});

test('Preview replaces the Production public client with the verified Staging target', () => {
  const result = prepareEpisodeReaderTemplate(
    originalTemplate,
    previewEnv()
  );
  assert.equal(result.preview, true);
  assert.match(result.html, /const client=supabase\.createClient\(/u);
  assert.ok(result.html.includes(STAGING_URL));
  assert.ok(result.html.includes(PUBLIC_KEY));
  assert.ok(!result.html.includes(PRODUCTION_URL));
  assert.ok(!result.html.includes('sb_secret_fixture_only'));
});

test('Preview rejects drift and never falls back to Production', () => {
  const unsafeConfigurations = [
    ['Production server URL', { SUPABASE_URL: PRODUCTION_URL }],
    ['Production expected browser URL', { NOVELIGHT_STAGING_SUPABASE_URL: PRODUCTION_URL }],
    ['mismatched server project', { SUPABASE_URL: 'https://other-project.supabase.co' }],
    ['missing server project', { SUPABASE_URL: undefined }],
    ['missing browser project', { NOVELIGHT_STAGING_SUPABASE_URL: undefined }],
    ['wrong browser publishable key', { NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_different_fixture' }],
    ['wrong server publishable key', { SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_different_fixture' }],
    ['server secret absent', { SUPABASE_SECRET_KEY: undefined }],
    ['server secret empty', { SUPABASE_SECRET_KEY: ' ' }],
    ['legacy privileged browser key', { NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_invalid' }],
    ['non-TLS server URL', { SUPABASE_URL: 'http://safe-staging-fixture.supabase.co' }],
    ['server URL contains an unexpected path', { SUPABASE_URL: STAGING_URL + '/rest/v1' }],
    ['server URL with query', { SUPABASE_URL: STAGING_URL + '/?secret=1' }],
    ['server URL with port', { SUPABASE_URL: 'https://safe-staging-fixture.supabase.co:8443' }],
    ['missing Vercel environment', { VERCEL_ENV: undefined }],
    ['development environment', { VERCEL_ENV: 'development' }]
  ];
  for (const [caseName, overrides] of unsafeConfigurations) {
    assert.throws(
      () => prepareEpisodeReaderTemplate(originalTemplate, previewEnv(overrides)),
      /EPISODE_PREVIEW_/u,
      caseName
    );
  }
});

test('Preview rejects unexpected template shape instead of serving unchanged credentials', () => {
  assert.throws(
    () => prepareEpisodeReaderTemplate(
      originalTemplate.replace('const client=supabase.createClient(', 'const client = supabase.createClient('),
      previewEnv()
    ),
    /EPISODE_PREVIEW_TEMPLATE_DRIFT/u
  );
  assert.throws(
    () => prepareEpisodeReaderTemplate(
      originalTemplate + originalTemplate,
      previewEnv()
    ),
    /EPISODE_PREVIEW_TEMPLATE_DRIFT/u
  );
});

test('Preview SEO handler refuses unsafe configuration before performing DB reads', async () => {
  await withEnvironment(previewEnv({ SUPABASE_URL: PRODUCTION_URL }), async () => {
    for (const id of ['123', undefined]) {
      const res = response();
      await episodeHandler({ method: 'GET', query: { id } }, res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body, 'Episode preview environment unavailable');
      assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
      assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
      assert.ok(!res.body.includes(PRODUCTION_URL));
    }
  });
});

test('Preview SEO handler serves the no-ID shell using only isolated public config', async () => {
  await withEnvironment(previewEnv(), async () => {
    const res = response();
    await episodeHandler({ method: 'GET', query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
    assert.ok(res.body.includes(STAGING_URL));
    assert.ok(!res.body.includes(PRODUCTION_URL));
    assert.ok(!res.body.includes('sb_secret_fixture_only'));
  });
});

test('Vercel Preview uses the SEO function, not the unguarded local HTML shell', async () => {
  const ignore = await readFile(new URL('../.vercelignore', import.meta.url), 'utf8');
  const vercel = JSON.parse(
    await readFile(new URL('../vercel.json', import.meta.url), 'utf8')
  );
  assert.match(ignore, /^\/episode\.html$/mu);
  assert.ok(
    vercel.rewrites.some(
      (route) =>
        route.source === '/episode.html' &&
        route.destination === '/api/seo/episode'
    )
  );
});
