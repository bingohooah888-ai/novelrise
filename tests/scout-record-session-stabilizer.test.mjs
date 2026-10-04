import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync('scout-record.html', 'utf8');
const source = readFileSync(
  'novelight-scout-session-stabilizer.js',
  'utf8'
);
const url = 'https://fiepaguycecrredwrcwx.supabase.co';
const key = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';

function authResult(userId = null, error = null) {
  const user = userId ? { id: userId } : null;
  const session = user ? { user } : null;
  return { data: { session }, error };
}

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

test('stabilizer loads before page clients', () => {
  const vendor = html.indexOf('/assets/vendor/supabase-js-2.112.3.js');
  const stabilizer = html.indexOf(
    'novelight-scout-session-stabilizer.js'
  );
  const client = html.indexOf('novelight-client.js');
  const scout = html.indexOf('novelight-scout-record.js');

  assert.ok(vendor >= 0);
  assert.ok(stabilizer > vendor);
  assert.ok(client > stabilizer);
  assert.ok(scout > client);
});

test('canonical clients are shared', () => {
  let count = 0;
  const window = install(() => {
    count += 1;
    return {
      auth: {
        async getSession() {
          return authResult('reader-1');
        }
      }
    };
  });
  const create = window.supabase.createClient;
  const first = create(url, key);
  const second = create(url, key);
  const third = create(url, key);

  assert.strictEqual(first, second);
  assert.strictEqual(second, third);
  assert.equal(count, 1);
});

test('explicit options keep separate clients', () => {
  let count = 0;
  const window = install(() => {
    count += 1;
    return {
      auth: {
        async getSession() {
          return authResult();
        }
      }
    };
  });
  const create = window.supabase.createClient;
  const options = { auth: { persistSession: false } };
  const first = create(url, key, options);
  const second = create(url, key, options);

  assert.notStrictEqual(first, second);
  assert.equal(count, 2);
});

test('null sessions retry and real errors stop', async () => {
  let calls = 0;
  const window = install(() => ({
    auth: {
      async getSession() {
        calls += 1;
        if (calls < 4) return authResult();
        return authResult('reader-1');
      }
    }
  }));
  const client = window.supabase.createClient(url, key);
  const recovered = await client.auth.getSession();

  assert.equal(recovered.data.session.user.id, 'reader-1');
  assert.equal(calls, 4);

  let errorCalls = 0;
  const expectedError = new Error('auth failed');
  const errorWindow = install(() => ({
    auth: {
      async getSession() {
        errorCalls += 1;
        return authResult(null, expectedError);
      }
    }
  }));
  const errorClient = errorWindow.supabase.createClient(url, key);
  const failed = await errorClient.auth.getSession();

  assert.strictEqual(failed.error, expectedError);
  assert.equal(errorCalls, 1);
});

test('stabilizer never synthesizes credentials', () => {
  assert.match(source, /const retryAttempts = 4;/);
  assert.match(source, /const retryDelayMs = 150;/);
  assert.match(source, /sharedCanonicalClient/);
  assert.doesNotMatch(source, /access_token\s*:/);
  assert.doesNotMatch(source, /refresh_token\s*:/);
  assert.doesNotMatch(source, /session\s*=\s*\{/);
});
