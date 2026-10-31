// One-use protected Preview browser proof, launched ONLY from trusted Staging
// runner after Vercel metadata attestation and synthetic fixture creation.
// No screenshots, traces, raw HTTP output, real AI calls or token logging.
import { pathToFileURL } from 'node:url';
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
  const browser = await chromium.launch({ headless: true });
  let context;
  let page;
  const apiPosts = [];
  try {
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
    const url =
      origin +
      '/login.html?redirect=' +
      encodeURIComponent('story-notes.html?novel_id=' + WORK_ID);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (new URL(page.url()).origin !== origin) denied();
    await page.locator('#email').fill(env.NOVELIGHT_HOSTED_TEST_EMAIL);
    await page.locator('#password').fill(env.NOVELIGHT_HOSTED_TEST_PASSWORD);
    await page.locator('#loginButton').click();
    await page.waitForURL(
      (value) =>
        value.origin === origin &&
        value.pathname.endsWith('/story-notes.html') &&
        value.searchParams.get('novel_id') === String(WORK_ID),
      { timeout: 25000 }
    );
    await page.locator('#workTitle').waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForFunction(
      () => document.querySelector('#workTitle')?.textContent?.includes('Synthetic consent JWT proof'),
      { timeout: 20000 }
    );
    if (await page.locator('.novelight-ai-bible-trial-section').count()) denied();
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
    const evidence = page.getByText('本文根拠：凛は青い鍵を持っていた。');
    await evidence.waitFor({ state: 'visible', timeout: 15000 });
    const accept = page.getByRole('button', { name: '採用（要確認）' });
    if (await accept.count() !== 1) denied();
    await accept.click();
    await evidence.waitFor({ state: 'detached', timeout: 15000 });
    if (apiPosts.length !== 1 ||
        apiPosts[0] !== '/api/ai-owner-bible-review') denied();

    await page.evaluate(async () => {
      if (typeof client === 'object') await client.auth.signOut();
    });
    return true;
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
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
