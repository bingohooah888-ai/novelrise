import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import productionEnvironmentHandler from '../api/public-production-environment.js';

const source = readFileSync(
  new URL('../novelight-client.js', import.meta.url),
  'utf8'
);
const start = source.indexOf('  let verifiedProductionDeploymentHost = null;');
const end = source.indexOf('  function validateStagingBrowserConfig', start);

assert.ok(start >= 0 && end > start, 'deployment host gate must be present');
const detectorSource = source.slice(start, end);

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

function classifyHost(host, status = 404, body = null, offline = false) {
  let calls = 0;
  class Request {
    open(method, path, async) {
      assert.equal(method, 'GET');
      assert.equal(path, '/api/public-production-environment');
      assert.equal(async, false);
    }
    setRequestHeader() {}
    send() {
      calls++;
      if (offline) throw new Error('offline');
      this.status = status;
      this.responseText = JSON.stringify(body);
    }
  }
  const detect = new Function(
    'window',
    'XMLHttpRequest',
    'VERCEL_INTERNAL_PRODUCTION_HOST',
    'VERCEL_PRODUCTION_ENV_PATH',
    detectorSource + '\nreturn isVercelPreviewHost;'
  )(
    { location: { hostname: host } },
    Request,
    'novelrise.vercel.app',
    '/api/public-production-environment'
  );

  return { first: detect(), second: detect(), calls };
}

test('CLI Production URL is not mistaken for Preview when server proves Production', () => {
  const result = classifyHost('novelrise-lhldj1lfh-ranobe1.vercel.app', 200, {
    vercelEnv: 'production'
  });
  assert.deepEqual(result, { first: false, second: false, calls: 1 });
});

test('Preview and unverified deployment URLs always keep Staging fail-closed', () => {
  for (const result of [
    classifyHost('novelrise-feature-ranobe1.vercel.app', 404),
    classifyHost('novelrise-feature-ranobe1.vercel.app', 200, {
      vercelEnv: 'preview'
    }),
    classifyHost('novelrise-feature-ranobe1.vercel.app', 200, {
      vercelEnv: 'unknown'
    }),
    classifyHost('novelrise-feature-ranobe1.vercel.app', 404, null, true)
  ]) {
    assert.deepEqual(result, { first: true, second: true, calls: 1 });
  }
});

test('canonical Production and custom domain do not probe the environment', () => {
  assert.deepEqual(classifyHost('novelrise.vercel.app'), {
    first: false,
    second: false,
    calls: 0
  });
  assert.deepEqual(classifyHost('novelight.jp'), {
    first: false,
    second: false,
    calls: 0
  });
});

test('server permits only a non-secret Production confirmation', () => {
  const old = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = 'production';
    const prod = response();
    productionEnvironmentHandler({ method: 'GET' }, prod);
    assert.equal(prod.statusCode, 200);
    assert.deepEqual(prod.body, { vercelEnv: 'production' });
    assert.equal(prod.headers['Cache-Control'], 'no-store, max-age=0');

    process.env.VERCEL_ENV = 'preview';
    const preview = response();
    productionEnvironmentHandler({ method: 'GET' }, preview);
    assert.equal(preview.statusCode, 404);
    assert.deepEqual(preview.body, { error: 'Not found' });

    process.env.VERCEL_ENV = 'production';
    const post = response();
    productionEnvironmentHandler({ method: 'POST' }, post);
    assert.equal(post.statusCode, 405);
  } finally {
    if (old === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = old;
  }
});
