import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import handler, {
  buildStagingBrowserConfig
} from '../api/staging-browser-config.js';

const STAGING_URL_ENV = 'NOVELIGHT_STAGING_SUPABASE_URL';
const STAGING_KEY_ENV = 'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY';

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
    json(body) {
      this.body = body;
      return this;
    }
  };
}

async function withEnvironment(values, callback) {
  const previous = {};
  for (const [name, value] of Object.entries(values)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  try {
    await callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('Preview browser config exposes only browser-safe isolated Supabase values', () => {
  const config = buildStagingBrowserConfig({
    VERCEL_ENV: 'preview',
    [STAGING_URL_ENV]: 'https://staging-project.supabase.co',
    [STAGING_KEY_ENV]: 'sb_publishable_staging_example',
    SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_production_example',
    SUPABASE_SECRET_KEY: 'sb_secret_must_not_leak'
  });

  assert.deepEqual(config, {
    supabaseUrl: 'https://staging-project.supabase.co',
    supabasePublishableKey: 'sb_publishable_staging_example'
  });
  assert.doesNotMatch(JSON.stringify(config), /production_example/);
  assert.doesNotMatch(JSON.stringify(config), /sb_secret_must_not_leak/);
});

test('Preview browser config fails closed on Production or secret-class targets', () => {
  assert.equal(
    buildStagingBrowserConfig({
      VERCEL_ENV: 'preview',
      [STAGING_URL_ENV]: 'https://fiepaguycecrredwrcwx.supabase.co',
      [STAGING_KEY_ENV]: 'sb_publishable_staging_example'
    }),
    null
  );

  assert.equal(
    buildStagingBrowserConfig({
      VERCEL_ENV: 'preview',
      [STAGING_URL_ENV]: 'https://staging-project.supabase.co',
      [STAGING_KEY_ENV]: 'sb_secret_not_browser_safe'
    }),
    null
  );

  assert.equal(
    buildStagingBrowserConfig({
      VERCEL_ENV: 'production',
      [STAGING_URL_ENV]: 'https://staging-project.supabase.co',
      [STAGING_KEY_ENV]: 'sb_publishable_staging_example'
    }),
    null
  );
});

test('generic Supabase integration variables cannot override isolated Preview config', () => {
  const config = buildStagingBrowserConfig({
    VERCEL_ENV: 'preview',
    [STAGING_URL_ENV]: 'https://staging-project.supabase.co',
    [STAGING_KEY_ENV]: 'sb_publishable_staging_example',
    SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_production_example'
  });

  assert.deepEqual(config, {
    supabaseUrl: 'https://staging-project.supabase.co',
    supabasePublishableKey: 'sb_publishable_staging_example'
  });
});

test('browser config route is unavailable outside Preview', async () => {
  await withEnvironment({ VERCEL_ENV: 'production' }, () => {
    const res = response();
    handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  });
});

test('shared client bootstrap redirects Preview createClient calls and preserves Production host', async () => {
  const source = await readFile('novelight-client.js', 'utf8');

  assert.match(source, /PRODUCTION_VERCEL_HOST = 'novelrise\.vercel\.app'/);
  assert.match(
    source,
    /STAGING_BROWSER_CONFIG_PATH = '\/api\/staging-browser-config'/
  );
  assert.match(source, /host\.endsWith\('\.vercel\.app'\)/);
  assert.match(source, /host !== PRODUCTION_VERCEL_HOST/);
  assert.match(source, /window\.supabase\.createClient = function/);
  assert.match(source, /CONFIG_DRIFT: Refusing unsafe Staging Supabase target/);
});

test('every root HTML page that constructs a Supabase client loads the shared bootstrap first', async () => {
  const entries = await readdir('.', { withFileTypes: true });
  const htmlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => entry.name);

  const offenders = [];
  for (const file of htmlFiles) {
    const source = await readFile(file, 'utf8');
    if (!source.includes('supabase.createClient')) continue;

    const sharedIndex = source.indexOf('novelight-client.js');
    const createIndex = source.indexOf('supabase.createClient');
    if (sharedIndex === -1 || sharedIndex > createIndex) offenders.push(file);
  }

  assert.deepEqual(offenders, []);
});
