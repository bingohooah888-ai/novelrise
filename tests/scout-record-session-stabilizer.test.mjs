import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync('scout-record.html', 'utf8');
const source = readFileSync('novelight-scout-session-stabilizer.js', 'utf8');
const productionUrl = 'https://fiepaguycecrredwrcwx.supabase.co';
const productionKey = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';

function install(createClient) {
  const window = {
    supabase: { createClient },
    setTimeout(resolve) {
      resolve();
      return 1;
    }
  };
  vm.runInNewContext(source, { window, Promise, Object });
  return window;
}

test('SCOUT RECORD installs the auth-session stabilizer before page clients', () => {
  const vendor = html.indexOf('/assets/vendor/supabase-js-2.112.3.js');
  const stabilizer = html.indexOf('novelight-scout-session-stabilizer.js');
  const client = html.indexOf('novelight-client.js');
  const scout = html.indexOf('novelight-scout-record.js');

  assert.ok(vendor >= 0);
  assert.ok(stabilizer > vendor);
  assert.ok(client > stabilizer);
  assert.ok(scout > client);
});

test('SCOUT RECORD reuses one canonical default Supabase client', () => {
  let createCount = 0;
  const window = install(() => {
    createCount += 1;
    return {
      auth: {
        async getSession() {
          return {
            data: { session: { user: { id: 'reader-1' } } },
            error: null
          };
        }
      }
    };
  });

  const first = window.supabase.createClient(productionUrl, productionKey);
  const second = window.supabase.createClient(productionUrl, productionKey);
  const third = window.supabase.createClient(productionUrl, productionKey);

  assert.strictEqual(first, second);
  assert.strictEqual(second, third);
  assert.equal(createCount, 1);
});

test('SCOUT RECORD does not collapse clients with explicit options', () => {
  let createCount = 0;
  const window = install(() => {
    createCount += 1;
    return {
      auth: {
        async getSession() {
          return { data: { session: null }, error: null };
        }
      }
    };
  });

  const options = { auth: { persistSession: false } };
  const first = window.supabase.createClient(
    productionUrl,
    productionKey,
    options
  );
  const second = window.supabase.createClient(
    productionUrl,
    productionKey,
    options
  );

  assert.notStrictEqual(first, second);
  assert.equal(createCount, 2);
});

test(
  'SCOUT RECORD retries transient null sessions and preserves real auth errors',
  async () => {
    let sessionCalls = 0;
    const window = install(() => ({
      auth: {
        async getSession() {
          sessionCalls += 1;
          if (sessionCalls < 4) {
            return { data: { session: null }, error: null };
          }
          return {
            data: { session: { user: { id: 'reader-1' } } },
            error: null
          };
        }
      }
    }));

    const client = window.supabase.createClient(productionUrl, productionKey);
    const recovered = await client.auth.getSession();
    assert.equal(recovered.data.session.user.id, 'reader-1');
    assert.equal(sessionCalls, 4);

    let errorCalls = 0;
    const errorWindow = install(() => ({
      auth: {
        async getSession() {
          errorCalls += 1;
          return {
            data: { session: null },
            error: new Error('auth failed')
          };
        }
      }
    }));
    const errorClient = errorWindow.supabase.createClient(
      productionUrl,
      productionKey
    );
    const failed = await errorClient.auth.getSession();
    assert.equal(failed.error.message, 'auth failed');
    assert.equal(errorCalls, 1);
  }
);

test('SCOUT RECORD stabilizer remains fail closed and never synthesizes credentials', () => {
  assert.match(source, /const retryAttempts = 4;/);
  assert.match(source, /const retryDelayMs = 150;/);
  assert.match(source, /sharedCanonicalClient/);
  assert.doesNotMatch(source, /access_token\s*:/);
  assert.doesNotMatch(source, /refresh_token\s*:/);
  assert.doesNotMatch(source, /session\s*=\s*\{/);
});