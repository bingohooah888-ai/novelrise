import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const PREVIEW_HOST = 'novelrise-isyvg7cnr-ranobe1.vercel.app';
const AUTH_PAGES = [
  'login.html',
  'signup.html',
  'forgot-password.html',
  'reset-password.html'
];

function clientInitializer(file) {
  const html = readFileSync(file, 'utf8');
  let marker = 'const isPreviewAuthHost =';
  if (file === 'login.html') {
    marker = "const SUPABASE_URL='";
  }
  const start = html.indexOf(marker);
  const end = html.indexOf('const form=', start);
  assert.ok(start !== -1 && end > start);
  return html.slice(start, end);
}

function executeInitializer(file, hostname, guardedFactory) {
  const calls = [];
  const scopeWindow = {};
  if (guardedFactory) {
    scopeWindow.NovelightClient = {
      createAuthClient(...args) {
        calls.push('guarded');
        return guardedFactory(...args);
      }
    };
  }
  const scope = {
    location: { hostname },
    window: scopeWindow,
    supabase: {
      createClient() {
        calls.push('direct');
        return {};
      }
    }
  };
  function run() {
    runInNewContext(clientInitializer(file), scope, { timeout: 1000 });
  }
  return { calls, run };
}

for (const file of AUTH_PAGES) {
  test(`${file}: missing bootstrap blocks Preview auth`, () => {
    const { calls, run } = executeInitializer(file, PREVIEW_HOST);
    assert.throws(run, /AUTH_PREVIEW_BOOTSTRAP_MISSING/);
    assert.deepEqual(calls, []);
  });

  test(`${file}: Preview uses guarded auth factory`, () => {
    const { calls, run } = executeInitializer(file, PREVIEW_HOST, () => ({}));
    assert.doesNotThrow(run);
    assert.deepEqual(calls, ['guarded']);
  });

  test(`${file}: Staging failure never falls back`, () => {
    const { calls, run } = executeInitializer(file, PREVIEW_HOST, () => {
      throw new Error('CONFIG_DRIFT');
    });
    assert.throws(run, /CONFIG_DRIFT/);
    assert.deepEqual(calls, ['guarded']);
  });

  test(`${file}: Production fallback is preserved`, () => {
    const { calls, run } = executeInitializer(file, 'novelight.jp');
    assert.doesNotThrow(run);
    assert.deepEqual(calls, ['direct']);
  });
}

test('shared runtime exports a Preview-safe auth factory', () => {
  const source = readFileSync('novelight-client.js', 'utf8');
  assert.ok(source.includes('previewSupabaseBootstrapInstalled = false'));
  assert.ok(source.includes('previewSupabaseBootstrapInstalled = true'));
  assert.ok(source.includes('function createAuthClient(...args)'));
  assert.ok(source.includes('isVercelPreviewHost() && !previewSupabase'));
  assert.ok(source.includes('window.NovelightClient = {'));
  assert.ok(source.includes('createAuthClient,'));
});
