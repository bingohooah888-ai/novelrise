/* global client, document */
// One-use protected Preview browser proof, launched ONLY from trusted Staging
// runner after Vercel metadata attestation and synthetic fixture creation.
// No screenshots, traces, raw HTTP output, real AI calls or token logging.
import { pathToFileURL, URL } from 'node:url';
import { chromium } from '@playwright/test';

const STAGING_HOST = 'wmlzjgvxgoyrovdhbqbg.supabase.co';
const OWNER = '00000000-0000-4000-8000-000000000943';
const WORK_ID = 998891003;

function denied() {
  throw new Error('AI_020704_BROWSER_DENIED');
}

// Keep the strict one-use fixture and browser contract stable.
// prettier-ignore
export async function runHostedOwnerReviewBrowser(env = process.env) {
  if (
    env.NOVELIGHT_AI_020704_HOSTED_BROWSER_ADMITTED !== '1' ||
    !/^https:\/\/novelrise-[a-z0-9-]+-ranobe1\.vercel\.app$/u.test(
      env.NOVELIGHT_HOSTED_PREVIEW_ORIGIN || ''
    ) ||
    env.NOVELIGHT_HOSTED_TEST_USER_ID !== OWNER ||
    env.NOVELIGHT_HOSTED_TEST_NOVEL_ID !== String(WORK_ID) ||
    env.NOVELIGHT_HOSTED_TEST_EMAIL !== 'ai-review-jwt@example.invalid' ||
    typeof env.NOVELIGHT_HOSTED_TEST_PASSWORD !== 'string' ||
    env.NOVELIGHT_HOSTED_TEST_PASSWORD.length < 20 ||
    typeof env.VERCEL_AUTOMATION_BYPASS_SECRET !== 'string' ||
    env.VERCEL_AUTOMATION_BYPASS_SECRET.length < 16
  ) denied();
  const origin = env.NOVELIGHT_HOSTED_PREVIEW_ORIGIN;
  const target = new URL(origin).hostname;
  let browser;
  let context;
  let page;
  const apiPosts = [];
  let phase = 'CHROME_LAUNCH';
  try {
    // CI's ubuntu-latest runner provides Chrome; no Playwright download is needed.
    // Launch must be within the sanitized phase handler.
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    phase = 'BROWSER_CONTEXT';
    context = await browser.newContext({ locale: 'ja-JP' });
    page = await context.newPage();
    // Vercel bypass credential must ONLY be delivered to the pinned Preview.
    // Never attach it to requests to Supabase, fonts, analytics or redirects.
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.protocol !== 'https:') {
        return route.abort('blockedbyclient');
      }
      if (url.hostname === target) {
        const headers = {
          ...route.request().headers(),
          'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET
        };
        return route.continue({ headers });
      }
      if (url.hostname === STAGING_HOST) {
        return route.continue();
      }
      return route.abort('blockedbyclient');
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.hostname === target &&
          url.pathname.startsWith('/api/ai-owner-bible-') &&
          request.method() === 'POST') {
        apiPosts.push(url.pathname);
      }
    });
    // story-notes.html is NOT in the shared login redirect allowlist.
    // Authenticate through an existing allowed author route, then navigate
    // explicitly to the private notes page with the same real JWT session.
    phase = 'LOGIN_PAGE';
    const loginUrl =
      origin + '/login.html?redirect=' +
      encodeURIComponent('my-novels.html');
    await page.goto(loginUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 25000
    });
    if (new URL(page.url()).origin !== origin) denied();
    phase = 'LOGIN_FORM';
    await page.locator('#email').fill(env.NOVELIGHT_HOSTED_TEST_EMAIL);
    await page.locator('#password').fill(env.NOVELIGHT_HOSTED_TEST_PASSWORD);
    await page.locator('#loginButton').click();
    phase = 'LOGIN_REDIRECT';
    await page.waitForURL(
      (value) =>
        value.origin === origin && value.pathname.endsWith('/my-novels.html'),
      { timeout: 25000 }
    );
    phase = 'STORY_PAGE';
    await page.goto(origin + '/story-notes.html?novel_id=' + WORK_ID, {
      waitUntil: 'domcontentloaded',
      timeout: 25000
    });
    if (new URL(page.url()).origin !== origin) denied();
    phase = 'OWNER_LOADED';
    await page.locator('#workTitle').waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForFunction(
      () => document.querySelector('#workTitle')?.textContent?.includes('Synthetic consent JWT proof'),
      { timeout: 20000 }
    );
    if (await page.locator('.novelight-ai-bible-trial-section').count()) denied();
    phase = 'REVIEW_ATTACH';
    const proof = await page.evaluate(async ({ owner, novelId }) => {
      // This code runs in the actual hosted page and uses the page's client.
      if (typeof client !== 'object' ||
          !globalThis.NovelightAiBibleReviewActions?.attach) return false;
      const auth = await client.auth.getSession();
      if (auth.error ||
          auth.data?.session?.user?.id !== owner ||
          !auth.data.session.access_token) return false;
      return globalThis.NovelightAiBibleReviewActions.attach({
        client,
        novelId,
        ownerId: owner
      });
    }, { owner: OWNER, novelId: WORK_ID });
    if (proof !== true) denied();
    const title = page.getByRole('heading', {
      name: '作品カルテ・AI候補の確認（管理人限定）'
    });
    await title.waitFor({ state: 'visible', timeout: 15000 });
    phase = 'CANDIDATE';
    const evidence = page.getByText('本文根拠：凛は青い鍵を持っていた。');
    await evidence.waitFor({ state: 'visible', timeout: 15000 });
    const accept = page.getByRole('button', { name: '採用（要確認）' });
    if (await accept.count() !== 1) denied();
    phase = 'ACCEPT';
    // Register the response listener BEFORE the click. A disappearing row
    // alone is not proof of success: the UI also removes stale private data.
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.hostname === target &&
        url.pathname === '/api/ai-owner-bible-review' &&
        response.request().method() === 'POST';
    }, { timeout: 15000 });
    await accept.click();
    phase = 'POST_RESPONSE';
    const response = await responsePromise;
    const status = response.status();
    if (status !== 200) {
      // Only emit fixed classifications, never headers, response body or JWT.
      const category = [401, 403, 404].includes(status) ? 'AUTH_SCOPE' :
        status === 409 ? 'STALE_SOURCE' :
          status >= 500 ? 'SERVER_UNAVAILABLE' : 'OTHER_HTTP';
      process.stderr.write('AI_020704_BROWSER_HTTP_CLASS:' + category + '\n');
      denied();
    }
    const decision = await response.json();
    if (!decision ||
        !Number.isSafeInteger(decision.candidateId) ||
        decision.candidateId < 1 ||
        decision.novelId !== WORK_ID ||
        decision.status !== 'accepted' ||
        decision.revision !== 2 ||
        decision.canonModified !== false) denied();
    phase = 'DOM_ACCEPT';
    await evidence.waitFor({ state: 'detached', timeout: 15000 });
    phase = 'VERIFY';
    if (apiPosts.length !== 1 ||
        apiPosts[0] !== '/api/ai-owner-bible-review') denied();

    phase = 'SIGNOUT';
    // Supabase signOut() defaults to global. This browser uses a DIFFERENT
    // session from the runner's still-needed JWT: revoke this session only.
    const locallySignedOut = await page.evaluate(async () => {
      if (typeof client !== 'object') return false;
      const result = await client.auth.signOut({ scope: 'local' });
      if (result?.error) return false;
      const current = await client.auth.getSession();
      return !current.error && !current.data?.session;
    });
    if (!locallySignedOut) denied();
    return true;
  } catch {
    // Emit ONLY a fixed phase label; never the error, credentials, URL
    // parameters, JWT, response text, or unpublished synthetic content.
    process.stderr.write('AI_020704_BROWSER_FAILURE_PHASE:' + phase + '\n');
    denied();
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

// Keep the strict one-use fixture and browser contract stable.
// prettier-ignore
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runHostedOwnerReviewBrowser();
    process.stdout.write('AI_020704_HOSTED_REAL_BROWSER_REVIEW_PASS\n');
  } catch {
    console.error('AI_020704_HOSTED_BROWSER_DENIED');
    process.exitCode = 1;
  }
}
