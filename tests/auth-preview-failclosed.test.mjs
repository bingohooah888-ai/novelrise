import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const AUTH_PAGES = [
  'login.html',
  'signup.html',
  'forgot-password.html',
  'reset-password.html'
];

function clientInitializer(file) {
  const html = readFileSync(file, 'utf8');
  const startMarker =
    file === 'login.html'
      ? "const SUPABASE_URL='"
      : 'const isPreviewAuthHost =';
  const start = html.indexOf(startMarker);
  const end = html.indexOf('const form=', start);
  assert.ok(start !== -1 && end > start);
  return html.slice(start, end);
}

function executeInitializer(file, hostname, createAuthClient) {
  const calls = [];
  const client = {};
  const scope = {
    location: { hostname },
    window: createAuthClient
      ? {
          NovelightClient: {
            createAuthClient(...args) {
              calls.push({ route: 'guarded', args });
              return createAuthClient(...args);
            }
          }
        }
      : {},
    supabase: {
      createClient(...args) {
        calls.push({ route: 'direct', args });
        return client;
      }
    }
  };
  const run = () =>
    runInNewContext(clientInitializer(file), scope, { timeout: 1000 });
  return { calls, run };
}

for (const file of AUTH_PAGES) {
  test(`${file}: Preview blocks missing bootstrap`, () => {
    const { calls, run } = executeInitializer(
      file,
      'novelrise-isyvg7cnr-ranobe1.vercel.app'
    );
    assert.throws(run, /AUTH_PREVIEW_BOOTSTRAP_MISSING/);
    assert.equal(calls.length, 0);
  });

  test(`${file}: Preview uses guarded factory`, () => {
    const { calls, run } = executeInitializer(
      file,
      'novelrise-isyvg7cnr-ranobe1.vercel.app',
      () => ({})
    );
    assert.doesNotThrow(run);
    assert.deepEqual(calls.map((call) => call.route), ['guarded']);
  });

  test(`${file}: Staging failure cannot fall back`, () => {
    const { calls, run } = executeInitializer(
      file,
      'novelrise-isyvg7cnr-ranobe1.vercel.app',
      () => {
        throw new Error('CONFIG_DRIFT: Staging browser config unavailable');
      }
    );
    assert.throws(run, /CONFIG_DRIFT/);
    assert.deepEqual(calls.map((call) => call.route), ['guarded']);
  });

  test(`${file}: Production fallback is preserved`, () => {
    const { calls, run } = executeInitializer(file, 'novelight.jp');
    assert.doesNotThrow(run);
    assert.deepEqual(calls.map((call) => call.route), ['direct']);
  });
}

test('shared runtime exports Preview-safe auth factory', () => {
  const source = readFileSync('novelight-client.js', 'utf8');
  assert.match(source, /previewSupabaseBootstrapInstalled = false/);
  assert.match(source, /previewSupabaseBootstrapInstalled = true/);
  assert.match(source, /function createAuthClient\(\.\.\.args\)/);
  assert.match(
    source,
    /isVercelPreviewHost\(\) && !previewSupabaseBootstrapInstalled/
  );
  assert.match(source, /window\.NovelightClient = \{\s*createAuthClient,/);
});
