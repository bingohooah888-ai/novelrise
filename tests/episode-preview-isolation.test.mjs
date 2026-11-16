import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import episodeHandler from '../api/seo/episode.js';
import { prepareEpisodeReaderTemplate } from '../api/seo/episode-preview-isolation.js';

const template = await readFile(
  new URL('../api/seo/templates/episode.html', import.meta.url),
  'utf8'
);
const stagingUrl = 'https://safe-staging-fixture.supabase.co';
const productionUrl = 'https://fiepaguycecrredwrcwx.supabase.co';
const publicKey = 'sb_publishable_safe_fixture_key_for_tests';

function previewEnv(overrides = {}) {
  return {
    VERCEL_ENV: 'preview',
    SUPABASE_URL: stagingUrl,
    NOVELIGHT_STAGING_SUPABASE_URL: stagingUrl,
    SUPABASE_PUBLISHABLE_KEY: publicKey,
    NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY: publicKey,
    SUPABASE_SECRET_KEY: 'sb_secret_fixture_only_never_a_real_credential',
    ...overrides
  };
}

function denied(overrides) {
  assert.throws(
    () => prepareEpisodeReaderTemplate(template, previewEnv(overrides)),
    /EPISODE_PREVIEW_/u
  );
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

test('Production episode template is unchanged', () => {
  const result = prepareEpisodeReaderTemplate(template, {
    VERCEL_ENV: 'production'
  });
  assert.equal(result.preview, false);
  assert.equal(result.html, template);
});

test('Preview uses only matching isolated browser and server targets', () => {
  const result = prepareEpisodeReaderTemplate(template, previewEnv());
  assert.equal(result.preview, true);
  assert.match(result.html, /const client=supabase\.createClient\(/u);
  assert.ok(result.html.includes(stagingUrl));
  assert.ok(result.html.includes(publicKey));
  assert.ok(!result.html.includes(productionUrl));
  assert.ok(!result.html.includes('sb_secret_fixture_only'));
});

test('Preview rejects unsafe connection details without fallback', () => {
  const badTargets = [
    { SUPABASE_URL: productionUrl },
    { NOVELIGHT_STAGING_SUPABASE_URL: productionUrl },
    { SUPABASE_URL: 'https://other-project.supabase.co' },
    { SUPABASE_URL: undefined },
    { NOVELIGHT_STAGING_SUPABASE_URL: undefined },
    { SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_other_fixture' },
    { SUPABASE_SECRET_KEY: undefined },
    { SUPABASE_SECRET_KEY: ' ' },
    { SUPABASE_URL: 'http://safe-staging-fixture.supabase.co' },
    { SUPABASE_URL: stagingUrl + '/rest/v1' },
    { SUPABASE_URL: stagingUrl + '/?secret=1' },
    { SUPABASE_URL: 'https://safe-staging-fixture.supabase.co:8443' },
    { VERCEL_ENV: undefined },
    { VERCEL_ENV: 'development' }
  ];
  for (const badTarget of badTargets) denied(badTarget);
  denied({
    NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY:
      'sb_publishable_other_fixture'
  });
  denied({
    NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_not_public'
  });
});

test('Preview blocks unrecognized or duplicated browser templates', () => {
  const drift = template.replace(
    'const client=supabase.createClient(',
    'const client = supabase.createClient('
  );
  assert.throws(
    () => prepareEpisodeReaderTemplate(drift, previewEnv()),
    /EPISODE_PREVIEW_TEMPLATE_DRIFT/u
  );
  assert.throws(
    () => prepareEpisodeReaderTemplate(template + template, previewEnv()),
    /EPISODE_PREVIEW_TEMPLATE_DRIFT/u
  );
});

test('Preview SEO route fails before DB access with unsafe settings', async () => {
  const unsafe = previewEnv({ SUPABASE_URL: productionUrl });
  await withEnvironment(unsafe, async () => {
    for (const id of ['123', undefined]) {
      const res = response();
      await episodeHandler({ method: 'GET', query: { id } }, res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body, 'Episode preview environment unavailable');
      assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
      assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
      assert.ok(!res.body.includes(productionUrl));
    }
  });
});

test('Preview SEO no-ID page contains only the Staging client', async () => {
  await withEnvironment(previewEnv(), async () => {
    const res = response();
    await episodeHandler({ method: 'GET', query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
    assert.ok(res.body.includes(stagingUrl));
    assert.ok(!res.body.includes(productionUrl));
    assert.ok(!res.body.includes('sb_secret_fixture_only'));
  });
});

test('Vercel Preview serves the guarded SEO function, not a raw shell', async () => {
  const ignore = await readFile(
    new URL('../.vercelignore', import.meta.url),
    'utf8'
  );
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
