import { readFileSync, writeFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';

const fixturePath = process.env.PRODUCTION_AUTH_SMOKE_FIXTURE;
const smokeLabel = process.env.AUTH_SMOKE_LABEL || '本番認証スモーク';
const checkoutSessionPrefix = process.env.CHECKOUT_SESSION_PREFIX || 'cs_live_';
const e2eSupabaseUrl = process.env.E2E_SUPABASE_URL;
const e2eSupabasePublishableKey = process.env.E2E_SUPABASE_PUBLISHABLE_KEY;
const productionSupabaseHost = 'fiepaguycecrredwrcwx.supabase.co';
const productionSupabaseUrl = `https://${productionSupabaseHost}`;
const productionSupabasePublishableKey =
  'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
const exposureConversionRpcPath =
  '/rest/v1/rpc/record_novel_exposure_conversion';

if (!fixturePath) throw new Error('PRODUCTION_AUTH_SMOKE_FIXTURE is required.');

function resolveStagingSupabaseOverride() {
  if (!e2eSupabaseUrl && !e2eSupabasePublishableKey) return null;
  if (!e2eSupabaseUrl || !e2eSupabasePublishableKey) {
    throw new Error(
      'E2E_SUPABASE_URL and E2E_SUPABASE_PUBLISHABLE_KEY must be configured together.'
    );
  }

  const target = new globalThis.URL(e2eSupabaseUrl);
  if (
    target.protocol !== 'https:' ||
    !target.hostname.endsWith('.supabase.co')
  ) {
    throw new Error(
      'Authenticated staging E2E requires an HTTPS Supabase project URL.'
    );
  }
  if (target.hostname === productionSupabaseHost) {
    throw new Error(
      'Authenticated staging E2E refuses the production Supabase project.'
    );
  }

  return {
    url: target.origin,
    key: e2eSupabasePublishableKey,
    projectRef: target.hostname.split('.')[0]
  };
}

const stagingSupabaseOverride = resolveStagingSupabaseOverride();

function loadFixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

function saveVisitorToken(role, token) {
  const fixture = loadFixture();
  fixture.visitorTokens = { ...(fixture.visitorTokens || {}), [role]: token };
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
}

function contextOptionsForProject(baseURL, projectName) {
  const descriptor = projectName.includes('mobile')
    ? devices['Pixel 7']
    : devices['Desktop Chrome'];
  const { defaultBrowserType: _defaultBrowserType, ...deviceOptions } =
    descriptor;
  return { ...deviceOptions, baseURL };
}

async function installStagingSupabaseOverride(context) {
  if (!stagingSupabaseOverride) return;

  await context.addInitScript(
    ({ url, key }) => {
      let assignedSupabase;
      Object.defineProperty(globalThis, 'supabase', {
        configurable: true,
        get() {
          return assignedSupabase;
        },
        set(value) {
          assignedSupabase = value;
          if (!value || typeof value.createClient !== 'function') return;

          const originalCreateClient = value.createClient.bind(value);
          value.createClient = (_url, _key, options) =>
            originalCreateClient(url, key, options);
        }
      });
    },
    {
      url: stagingSupabaseOverride.url,
      key: stagingSupabaseOverride.key
    }
  );
}

async function assertExpectedSupabaseSession(page) {
  if (!stagingSupabaseOverride) return;

  const authKeys = await page.evaluate(() => {
    const keys = [];
    for (let index = 0; index < globalThis.localStorage.length; index += 1) {
      const key = globalThis.localStorage.key(index);
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) keys.push(key);
    }
    return keys;
  });

  expect(authKeys).toContain(
    `sb-${stagingSupabaseOverride.projectRef}-auth-token`
  );
  expect(authKeys).not.toContain('sb-fiepaguycecrredwrcwx-auth-token');
}

async function login(page, account, redirect) {
  await page.goto(`/login.html?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.locator('#loginButton').click();
  await page.waitForURL((url) =>
    url.pathname.endsWith(`/${redirect.split('?')[0]}`)
  );
  await assertExpectedSupabaseSession(page);
  const visitorToken = await page.evaluate(() =>
    globalThis.localStorage.getItem('novelight_visitor_token')
  );
  expect(visitorToken).toBeTruthy();
  return visitorToken;
}

async function getSupabaseAccessToken(page) {
  const accessToken = await page.evaluate(() => {
    for (let index = 0; index < globalThis.localStorage.length; index += 1) {
      const key = globalThis.localStorage.key(index);
      if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue;

      const raw = globalThis.localStorage.getItem(key);
      if (!raw) continue;

      try {
        const stored = JSON.parse(raw);
        const token =
          stored?.access_token ?? stored?.currentSession?.access_token;
        if (token) return token;
      } catch {
        // Ignore unrelated or malformed local storage values.
      }
    }

    return null;
  });

  expect(accessToken).toBeTruthy();
  return accessToken;
}

async function recordDiscoveryImpression(page, novelId) {
  const target = stagingSupabaseOverride || {
    url: productionSupabaseUrl,
    key: productionSupabasePublishableKey
  };

  await page.waitForFunction(
    () => typeof globalThis.supabase?.createClient === 'function'
  );
  await page.evaluate(
    async ({ url, key, workId }) => {
      const client = globalThis.supabase.createClient(url, key);
      const session = await client.auth.getSession();
      if (!session.data.session) {
        throw new Error('Authenticated session was unavailable.');
      }

      const response = await client.rpc('record_novel_impressions_v2', {
        p_surface: 'home_discovery',
        p_novel_ids: [workId],
        p_visitor_token: null
      });
      if (response.error) throw new Error(response.error.message);
    },
    { url: target.url, key: target.key, workId: String(novelId) }
  );
}

function waitForExposureConversion(page, eventType) {
  return page.waitForResponse((response) => {
    if (
      !response.url().includes(exposureConversionRpcPath) ||
      response.request().method() !== 'POST'
    ) {
      return false;
    }
    const body = response.request().postData();
    return body?.includes(`"${eventType}"`) ?? false;
  });
}

async function readEpisodeAndRecord(page, episodeHref, title, label) {
  const conversion = waitForExposureConversion(page, 'episode_read_10s');
  await page.goto(`/${episodeHref}`);
  await expect(page.locator('#card h1')).toHaveText(title);
  await expect(pageContent(page)).toContainText(label);
  const response = await conversion;
  expect(response.ok()).toBeTruthy();
}

async function assertCheckoutSession(page, plan) {
  const accessToken = await getSupabaseAccessToken(page);
  const response = await page.request.post('/api/create-checkout-session', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    data: { plan }
  });

  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.mode).toBe('checkout');
  expect(body.url).toContain(checkoutSessionPrefix);
  expect(new globalThis.URL(body.url).hostname).toBe('checkout.stripe.com');
}

async function closeContextSafely(context) {
  try {
    await context.close();
  } catch (error) {
    if (
      !String(error).includes('Target page, context or browser has been closed')
    ) {
      throw error;
    }
  }
}

test(
  'authenticated beta-critical product flow works in target',
  async ({ browser, baseURL }, testInfo) => {
    const fixture = loadFixture();
    const deviceLabel = testInfo.project.name.includes('mobile')
      ? 'mobile'
      : 'desktop';
    const unique = `E2E-${fixture.runId}-${deviceLabel}`;
    const novelTitle = `${smokeLabel}作品 ${unique}`;
    const firstEpisodeTitle = `第1話 ${smokeLabel} ${unique}`;
    const secondEpisodeTitle = `第2話 ${smokeLabel} ${unique}`;
    const contextOptions = contextOptionsForProject(
      baseURL,
      testInfo.project.name
    );

    const authorContext = await browser.newContext(contextOptions);
    const readerContext = await browser.newContext(contextOptions);
    await Promise.all([
      installStagingSupabaseOverride(authorContext),
      installStagingSupabaseOverride(readerContext)
    ]);
    const authorPage = await authorContext.newPage();
    const readerPage = await readerContext.newPage();

    let novelId;
    let firstEpisodeHref;
    let secondEpisodeHref;

    try {
      await test.step('Author login', async () => {
        const authorVisitorToken = await login(
          authorPage,
          fixture.author,
          'post.html'
        );
        saveVisitorToken(`author-${deviceLabel}`, authorVisitorToken);
      });

      await test.step('Create novel', async () => {
        await authorPage.locator('#title').fill(novelTitle);
        await authorPage
          .locator('#genre')
          .selectOption({ label: '現代ドラマ' });
        await authorPage
          .locator('#description')
          .fill(
            `β公開前の${smokeLabel}専用作品です。テスト終了時に自動削除されます。`
          );
        await authorPage.locator('#aiUsage').selectOption('human');
        await authorPage.locator('#contentRating').selectOption('general');
        await authorPage.locator('#policyAck').check();
        await authorPage.locator('#submitButton').click();
        await authorPage.waitForURL(/\/episode-post\.html\?novel_id=/);

        novelId = new globalThis.URL(authorPage.url()).searchParams.get(
          'novel_id'
        );
        expect(novelId).toBeTruthy();
      });

      await test.step('Publish first episode', async () => {
        const publishButton = authorPage.locator('#publish');
        await expect(publishButton).toBeEnabled();
        await authorPage.locator('#episodeNumber').fill('1');
        await authorPage.locator('#title').fill(firstEpisodeTitle);
        await authorPage
          .locator('#content')
          .fill(
            `これはNOVELIGHTの${smokeLabel}用第1話本文です。読書画面と10秒読書記録を検証します。`
          );
        await publishButton.click();
        await authorPage.waitForURL(/\/novel\.html\?id=/);
        await expect(authorPage.locator('.title')).toHaveText(novelTitle);
        await expect(authorPage.locator('.episode-title').first()).toHaveText(
          firstEpisodeTitle
        );
        firstEpisodeHref = await authorPage
          .locator('.episode-title')
          .first()
          .getAttribute('href');
        expect(firstEpisodeHref).toMatch(/^episode\.html\?id=/);
      });

      await test.step('Publish second episode', async () => {
        await authorPage.goto(
          `/episode-post.html?novel_id=${encodeURIComponent(novelId)}`
        );
        const publishButton = authorPage.locator('#publish');
        await expect(publishButton).toBeEnabled();
        await authorPage.locator('#episodeNumber').fill('2');
        await authorPage.locator('#title').fill(secondEpisodeTitle);
        await authorPage
          .locator('#content')
          .fill(
            `これはNOVELIGHTの${smokeLabel}用第2話本文です。第1話から第2話への継続計測を検証します。`
          );
        await publishButton.click();
        await authorPage.waitForURL(/\/novel\.html\?id=/);
        await expect(authorPage.locator('.episode-title')).toHaveCount(2);
        secondEpisodeHref = await authorPage
          .locator('.episode-title')
          .nth(1)
          .getAttribute('href');
        expect(secondEpisodeHref).toMatch(/^episode\.html\?id=/);
      });

      await test.step(
        'Reader login and record discovery impression',
        async () => {
          const readerVisitorToken = await login(
            readerPage,
            fixture.reader,
            'mypage.html'
          );
          saveVisitorToken(`reader-${deviceLabel}`, readerVisitorToken);
          await recordDiscoveryImpression(readerPage, novelId);

          const detailConversion = waitForExposureConversion(
            readerPage,
            'detail_open'
          );
          await readerPage.goto(
            `/novel.html?id=${encodeURIComponent(novelId)}`
          );
          await expect(readerPage.locator('.title')).toHaveText(novelTitle);
          expect((await detailConversion).ok()).toBeTruthy();
        }
      );

      await test.step('Favorite novel', async () => {
        const favoriteButton = readerPage.locator('#favoriteButton');
        await expect(favoriteButton).toBeVisible();
        await expect(favoriteButton).toHaveText(/お気に入り/);
        const favoriteConversion = waitForExposureConversion(
          readerPage,
          'favorite_added'
        );
        await favoriteButton.click();
        await expect(favoriteButton).toHaveText(/お気に入り済み/);
        await expect(readerPage.locator('#favoriteCount')).toHaveText('1');
        expect((await favoriteConversion).ok()).toBeTruthy();
      });

      await test.step('Send LIGHT SEED', async () => {
        const seedButton = readerPage.locator('#seedButton');
        await expect(seedButton).toBeVisible();
        await expect(seedButton).toBeEnabled();
        readerPage.once('dialog', (dialog) => dialog.accept());
        await seedButton.click();
        await expect(seedButton).toBeDisabled();
        await expect(readerPage.locator('#seedMessage')).toContainText(
          'すでに贈っています'
        );
      });

      await test.step('Verify SCOUT RECORD', async () => {
        await readerPage.goto('/scout-record.html');
        await expect(
          readerPage.getByRole('heading', { name: 'SCOUT RECORD' })
        ).toBeVisible();
        await expect(
          readerPage.getByText(novelTitle, { exact: true })
        ).toBeVisible();
      });

      await test.step(
        'Read first and second episode with engagement',
        async () => {
          await readEpisodeAndRecord(
            readerPage,
            firstEpisodeHref,
            firstEpisodeTitle,
            smokeLabel
          );
          await readEpisodeAndRecord(
            readerPage,
            secondEpisodeHref,
            secondEpisodeTitle,
            smokeLabel
          );
        }
      );

      await test.step('Verify complete LIGHT ANALYTICS funnel', async () => {
        await authorPage.goto('/analytics.html');
        await expect(
          authorPage.getByRole('heading', { name: 'LIGHT ANALYTICS' })
        ).toBeVisible();
        await expect(authorPage.locator('#novelCount')).toHaveText('1');
        await expect(authorPage.locator('#favoriteTotal')).toHaveText('1');
        await expect(
          authorPage.locator('.work').filter({ hasText: novelTitle })
        ).toBeVisible();
        await expect(authorPage.locator('#impressions')).toHaveText('1');
        await expect(authorPage.locator('#detail')).toHaveText('1');
        await expect(authorPage.locator('#first')).toHaveText('1');
        await expect(authorPage.locator('#second')).toHaveText('1');
        await expect(authorPage.locator('#favorites')).toHaveText('1');
      });

      await test.step('Verify Stripe Checkout without charging', async () => {
        await assertCheckoutSession(authorPage, 'standard');
        await assertCheckoutSession(authorPage, 'premium');
      });

      await test.step('Delete work with one atomic parent request', async () => {
        await authorPage.goto(`/novel.html?id=${encodeURIComponent(novelId)}`);
        const deleteRequests = [];
        const captureDelete = (request) => {
          if (
            request.method() === 'DELETE' &&
            request.url().includes('/rest/v1/')
          ) {
            deleteRequests.push(request.url());
          }
        };
        authorPage.on('request', captureDelete);
        authorPage.once('dialog', (dialog) => dialog.accept());
        await authorPage.locator('#deleteNovel').click();
        await authorPage.waitForURL(/\/my-novels\.html$/);
        authorPage.off('request', captureDelete);

        expect(
          deleteRequests.some((url) => url.includes('/rest/v1/novels'))
        ).toBe(true);
        expect(
          deleteRequests.some((url) => url.includes('/rest/v1/episodes'))
        ).toBe(false);
        await expect(
          authorPage.getByText(novelTitle, { exact: true })
        ).toHaveCount(0);
      });
    } finally {
      await closeContextSafely(authorContext);
      await closeContextSafely(readerContext);
    }
  }
);

function pageContent(page) {
  return page.locator('#card .content');
}
