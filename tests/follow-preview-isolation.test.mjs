import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL } from 'node:url';
import test from 'node:test';

// Run the actual shared Preview bootstrap in a sandbox. No browser network,
// hosted Supabase, Vercel Preview or owner approval is involved.
const source = readFileSync('novelight-client.js', 'utf8');
const end = source.indexOf('\n  installPreviewSupabaseBootstrap();');
assert.ok(end > 0, 'shared preview bootstrap must exist');
const suffix = '\n  installPreviewSupabaseBootstrap();';
const bootstrap = source.slice(0, end + suffix.length).concat('\n})();');

function execute({ hostname, config, status = 200 }) {
  const calls = [];
  const requests = [];
  const client = { ok: true };
  const window = {
    location: { hostname },
    supabase: {
      createClient(...args) {
        calls.push(args);
        return client;
      }
    }
  };
  const document = {
    documentElement: { classList: { toggle() {} } }
  };
  class XMLHttpRequest {
    open(method, path, async) {
      requests.push({ method, path, async });
    }
    setRequestHeader() {}
    send() {
      this.status = status;
      this.responseText = JSON.stringify(config || {});
    }
  }
  runInNewContext(bootstrap, { window, document, XMLHttpRequest, URL });
  return { window, calls, requests, client };
}

test('following page loads shared client bootstrap before its own RPC client', () => {
  const html = readFileSync('following.html', 'utf8');
  const vendor = html.indexOf('src="/assets/vendor/supabase-js-2.112.3.js"');
  const bridge = html.indexOf('src="novelight-client.js"');
  const follow = html.indexOf('src="novelight-following-list.js"');
  assert.ok(vendor !== -1 && vendor < bridge && bridge < follow);
  assert.match(
    readFileSync('novelight-following-list.js', 'utf8'),
    /supabase\.createClient\s*\(/
  );
});

test('Vercel Preview rewrites the follow-list client to Staging only', () => {
  const staging = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
  const runtime = execute({
    hostname: 'novelrise-one-off-preview.vercel.app',
    config: {
      supabaseUrl: staging,
      supabasePublishableKey: 'sb_publishable_testonly'
    }
  });
  const prodUrl = 'https://fiepaguycecrredwrcwx.supabase.co';
  const created = runtime.window.supabase.createClient(
    prodUrl,
    'sb_publishable_productionplaceholder',
    { auth: { persistSession: true } }
  );
  assert.equal(created, runtime.client);
  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.calls[0][0], staging);
  assert.equal(runtime.calls[0][1], 'sb_publishable_testonly');
  assert.equal(runtime.calls[0][2].auth.persistSession, true);
  assert.equal(runtime.requests.length, 1);
  assert.equal(runtime.requests[0].method, 'GET');
  assert.equal(runtime.requests[0].path, '/api/staging-browser-config');
  assert.equal(runtime.requests[0].async, false);

  // Subsequent calls reuse the verified Staging config, not the Production URL.
  runtime.window.supabase.createClient(prodUrl, 'sb_publishable_other');
  assert.equal(runtime.calls[1][0], staging);
  assert.equal(runtime.requests.length, 1);
});

test('invalid/missing Preview config fails closed before creating any client', () => {
  for (const options of [
    { status: 404, config: {} },
    {
      status: 200,
      config: {
        supabaseUrl: 'https://fiepaguycecrredwrcwx.supabase.co',
        supabasePublishableKey: 'sb_publishable_testonly'
      }
    },
    {
      status: 200,
      config: {
        supabaseUrl: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
        supabasePublishableKey: 'sb_secret_not_acceptable'
      }
    }
  ]) {
    const runtime = execute({
      hostname: 'novelrise-one-off-preview.vercel.app',
      ...options
    });
    assert.throws(
      () =>
        runtime.window.supabase.createClient(
          'https://fiepaguycecrredwrcwx.supabase.co',
          'sb_publishable_testonly'
        ),
      /CONFIG_DRIFT/
    );
    assert.equal(runtime.calls.length, 0);
  }
});

test('Production canonical host keeps existing Production client behavior', () => {
  const runtime = execute({ hostname: 'novelight.jp', status: 404 });
  const productionUrl = 'https://fiepaguycecrredwrcwx.supabase.co';
  runtime.window.supabase.createClient(productionUrl, 'sb_publishable_prod');
  assert.equal(runtime.calls[0][0], productionUrl);
  assert.equal(runtime.requests.length, 0);
});
