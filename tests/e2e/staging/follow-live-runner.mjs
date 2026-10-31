// Trusted-main runner: one explicitly approved Staging Preview + Auth proof.
// No credential/session/token contents are printed or saved as test artifacts.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const REF = 'wmlzjgvxgoyrovdhbqbg';
const STAGING = 'https://' + REF + '.supabase.co';
const PRODUCTION = 'fiepaguycecrredwrcwx.supabase.co';
const REVISION = /^[a-f0-9]{40}$/u;

function requireSafeEnvironment() {
  const env = process.env;
  const url = new URL(env.STAGING_SUPABASE_URL);
  const preview = new URL(env.CANONICAL_STAGING_URL);
  if (env.NOVELIGHT_FOLLOW_STAGE_ADMITTED !== '1' ||
      env.STAGING_SUPABASE_URL !== STAGING ||
      env.STAGING_EXPECTED_SUPABASE_URL !== STAGING ||
      !env.STAGING_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_') ||
      !env.STAGING_SUPABASE_SECRET_KEY?.startsWith('sb_secret_') ||
      !env.VERCEL_AUTOMATION_BYPASS_SECRET ||
      !REVISION.test(env.EXPECTED_REVISION || '') ||
      url.hostname === PRODUCTION ||
      preview.protocol !== 'https:' ||
      !preview.hostname.endsWith('.vercel.app') ||
      preview.hostname === 'novelrise.vercel.app') {
    throw new Error('FOLLOW_STAGE_PROOF_DENIED: invalid isolated Staging facts');
  }
  return { env, preview: preview.origin };
}

function check(result, label) {
  if (result?.error) {
    throw new Error(label + ': Staging API returned a sanitized failure');
  }
  return result.data;
}

async function createSyntheticUser(admin, created) {
  const email = 'follow-proof-' + randomUUID() + '@example.invalid';
  const password = 'Test1!' + randomBytes(25).toString('base64url');
  const response = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { display_name: 'Stage Follow Proof' }
  });
  const user = check(response, 'create synthetic user')?.user;
  if (!user?.id) throw new Error('synthetic user receipt unavailable');
  created.push(user.id);
  return { id: user.id, email, password };
}

async function signIn(url, key, user) {
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const result = await client.auth.signInWithPassword({
    email: user.email, password: user.password
  });
  const session = check(result, 'real JWT sign-in')?.session;
  if (!session?.access_token || session.user?.id !== user.id) {
    throw new Error('real JWT session identity invalid');
  }
  return { client, session };
}

async function checkPreviewConfig(preview, env) {
  const headers = {
    'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET
  };
  for (const [path, verify] of [
    ['/api/deployment-revision', (v) => v?.commitSha === env.EXPECTED_REVISION],
    ['/api/staging-browser-config', (v) => v?.supabaseUrl === STAGING &&
      String(v?.supabasePublishableKey || '').startsWith('sb_publishable_')]
  ]) {
    const response = await fetch(preview + path, {
      headers, signal: AbortSignal.timeout(15_000)
    });
    if (response.status !== 200) {
      throw new Error('Preview fact endpoint is unavailable: ' + path);
    }
    const data = await response.json();
    if (!verify(data)) throw new Error('Preview fact mismatch: ' + path);
  }
}

async function verifyBrowser(preview, env, session, tab, expectedName) {
  const browser = await chromium.launch({
    headless: true, channel: 'chrome'
  });
  try {
    const context = await browser.newContext();
    const key = 'sb-' + REF + '-auth-token';
    await context.addInitScript(({ storageKey, state }) => {
      globalThis.localStorage.setItem(storageKey, JSON.stringify(state));
    }, { storageKey: key, state: session });

    const previewHost = new URL(preview).hostname;
    await context.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.hostname === PRODUCTION ||
          ![previewHost, REF + '.supabase.co'].includes(url.hostname)) {
        return route.abort('blockedbyclient');
      }
      if (url.hostname === previewHost) {
        if (req.method() !== 'GET' && req.method() !== 'HEAD') {
          return route.abort('blockedbyclient');
        }
        return route.continue({
          headers: {
            ...req.headers(),
            'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET
          }
        });
      }
      return route.continue();
    });

    const page = await context.newPage();
    await page.goto(preview + '/following.html?tab=' + tab, {
      waitUntil: 'domcontentloaded'
    });
    await page.getByRole('tab', { name: tab === 'followers'
      ? /フォロワー/u : /フォロー中/u }).waitFor();
    await page.locator('.follow-card').first().waitFor({ timeout: 15_000 });
    const html = await page.locator('.follow-card').first().textContent();
    assert.ok(html?.includes(expectedName), 'synthetic relationship not rendered');
    assert.equal(await page.locator('.follow-card').count(), 1);
    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  const { env, preview } = requireSafeEnvironment();
  const admin = createClient(STAGING, env.STAGING_SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const created = [];
  let first = null;
  let failed = null;
  try {
    await checkPreviewConfig(preview, env);
    const author = await createSyntheticUser(admin, created);
    const reader = await createSyntheticUser(admin, created);
    const authorAuth = await signIn(
      STAGING, env.STAGING_SUPABASE_PUBLISHABLE_KEY, author
    );
    const readerAuth = await signIn(
      STAGING, env.STAGING_SUPABASE_PUBLISHABLE_KEY, reader
    );
    first = readerAuth;
    const empty = check(
      await readerAuth.client.rpc('novelight_follow_counts'),
      'initial counts'
    );
    assert.equal(Number(empty.following), 0);
    check(await readerAuth.client.rpc('novelight_set_author_follow', {
      p_author_user_id: author.id, p_following: true
    }), 'follow author');

    const following = check(
      await readerAuth.client.rpc('novelight_followed_authors', {
        p_limit: 25, p_offset: 0
      }), 'own following list'
    );
    assert.equal(following.length, 1);
    assert.equal(following[0].author_user_id, author.id);
    const followers = check(
      await authorAuth.client.rpc('novelight_followers', {
        p_limit: 25, p_offset: 0
      }), 'own follower list'
    );
    assert.equal(followers.length, 1);
    assert.equal(followers[0].user_id, reader.id);

    check(await readerAuth.client.rpc(
      'novelight_set_author_follow_notifications',
      {
        p_author_user_id: author.id,
        p_notify_new_works: true,
        p_notify_updates: false
      }
    ), 'set notifications');
    const after = check(
      await authorAuth.client.rpc('novelight_follow_counts'),
      'author counts'
    );
    assert.equal(Number(after.followers), 1);

    const anonymous = createClient(
      STAGING, env.STAGING_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false } }
    );
    const denied = await anonymous.rpc('novelight_follow_counts');
    assert.ok(denied.error, 'anonymous must not access private follow RPC');

    const authorName = following[0].display_name;
    const readerName = followers[0].display_name;
    if (!authorName || !readerName) {
      throw new Error('synthetic profile display names unavailable');
    }
    await verifyBrowser(preview, env, readerAuth.session, 'following', authorName);
    await verifyBrowser(preview, env, authorAuth.session, 'followers', readerName);

    check(await readerAuth.client.rpc('novelight_set_author_follow', {
      p_author_user_id: author.id, p_following: false
    }), 'unfollow');
    const restored = check(
      await authorAuth.client.rpc('novelight_follow_counts'),
      'unfollow counts'
    );
    assert.equal(Number(restored.followers), 0);
    console.log('FOLLOW_STAGE_PROOF_PASS: real JWT, owner-bound RPC, Preview UI');
  } catch (error) {
    failed = error;
  } finally {
    if (first) {
      await first.client.auth.signOut().catch(() => {});
    }
    let cleanupFailed = false;
    for (const id of created.reverse()) {
      const result = await admin.auth.admin.deleteUser(id);
      if (result.error) cleanupFailed = true;
    }
    if (cleanupFailed) {
      throw new Error('FOLLOW_STAGE_CLEANUP_FAILED: synthetic Auth users');
    }
    console.log('FOLLOW_STAGE_CLEANUP_PASS: synthetic users removed');
  }
  if (failed) throw failed;
}

main().catch((error) => {
  // No secret/token/identity values in exception messages or traces.
  console.error('FOLLOW_STAGE_PROOF_FAILED: ' +
    (error.message || 'sanitized error'));
  process.exitCode = 1;
});
