import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';

const runtime = readFileSync(
  new URL('../novelight-client.js', import.meta.url),
  'utf8'
);
const from = runtime.indexOf('  const sharedPublicAuthClients = new Map();');
const until = runtime.indexOf('  function createAuthClient(...args)', from);
assert.ok(from !== -1 && until > from, 'shared client factory must be present');
const source = runtime.slice(from, until);
const productionUrl = 'https://fiepaguycecrredwrcwx.supabase.co';
const key = 'sb_publishable_TEST_ONLY_PUBLIC_KEY';
const stage = {
  supabaseUrl: 'https://test-staging-only.supabase.co',
  supabasePublishableKey: 'sb_publishable_STAGING_TEST_ONLY'
};

function fixture({
  preview = false,
  activeConfig = null,
  brokenClient = false
} = {}) {
  let creations = 0;
  const actual = [];
  const scope = {
    supabase: {
      createClient(...args) {
        creations++;
        actual.push(args);
        return brokenClient
          ? { supabaseUrl: productionUrl, supabaseKey: key }
          : {
              supabaseUrl: preview ? stage.supabaseUrl : args[0],
              supabaseKey: preview ? stage.supabasePublishableKey : args[1],
              auth: { getSession: async () => ({ data: { session: null } }) }
            };
      }
    }
  };
  new Function(
    'window',
    'PRODUCTION_SUPABASE_HOST',
    'isVercelPreviewHost',
    'activeStagingBrowserConfig',
    source
  )(scope, 'fiepaguycecrredwrcwx.supabase.co', () => preview, activeConfig);
  return {
    scope,
    actual,
    get creations() {
      return creations;
    }
  };
}

test('same public project and key share one GoTrue client', () => {
  const f = fixture();
  const first = f.scope.supabase.createClient(productionUrl, key);
  const second = f.scope.supabase.createClient(productionUrl, key);
  assert.equal(first, second);
  assert.equal(f.creations, 1);
});
test('different publishable keys remain isolated', () => {
  const f = fixture();
  assert.notEqual(
    f.scope.supabase.createClient(productionUrl, key),
    f.scope.supabase.createClient(productionUrl, key + '_DIFFERENT')
  );
  assert.equal(f.creations, 2);
});
test('custom auth options are never cached or conflated', () => {
  const f = fixture();
  const opts = { auth: { persistSession: false } };
  const a = f.scope.supabase.createClient(productionUrl, key, opts);
  const b = f.scope.supabase.createClient(productionUrl, key, opts);
  assert.notEqual(a, b);
  assert.equal(f.creations, 2);
});
test('other Supabase projects remain isolated', () => {
  const f = fixture();
  const x = 'https://other.supabase.co';
  assert.notEqual(
    f.scope.supabase.createClient(x, key),
    f.scope.supabase.createClient(x, key)
  );
  assert.equal(f.creations, 2);
});
test('Preview caches only clients from validated Staging bootstrap', () => {
  const f = fixture({ preview: true, activeConfig: stage });
  const a = f.scope.supabase.createClient(productionUrl, key);
  assert.equal(a.supabaseUrl, stage.supabaseUrl);
  assert.equal(f.scope.supabase.createClient(productionUrl, key), a);
  assert.equal(f.creations, 1);
});
test('Preview refuses missing bootstrap and never caches unsafe client', () => {
  const f = fixture({ preview: true });
  assert.throws(
    () => f.scope.supabase.createClient(productionUrl, key),
    /unsafe Preview auth client/
  );
  assert.equal(f.creations, 1);
});
test('Preview refuses Production credential fallback even with a declared Staging config', () => {
  const f = fixture({
    preview: true,
    activeConfig: stage,
    brokenClient: true
  });
  assert.throws(
    () => f.scope.supabase.createClient(productionUrl, key),
    /unsafe Preview auth client/
  );
});
test('Scout notification capture deduplicates shared client registrations', () => {
  assert.match(
    runtime,
    /!window\.__novelightScoutTitleToastPendingClients\.includes\(client\)/
  );
});
