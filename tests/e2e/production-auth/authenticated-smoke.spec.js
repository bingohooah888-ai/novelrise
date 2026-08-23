import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const fixturePath = process.env.PRODUCTION_AUTH_SMOKE_FIXTURE;
if (!fixturePath) throw new Error('PRODUCTION_AUTH_SMOKE_FIXTURE is required.');

function loadFixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

function saveVisitorToken(role, token) {
  const fixture = loadFixture();
  fixture.visitorTokens = { ...(fixture.visitorTokens || {}), [role]: token };
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
}

async function login(page, account, redirect) {
  await page.goto(`/login.html?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.locator('#loginButton').click();
  await page.waitForURL((url) =>
    url.pathname.endsWith(`/${redirect.split('?')[0]}`)
  );
  const visitorToken = await page.evaluate(() =>
    globalThis.localStorage.getItem('novelight_visitor_token')
  );
  expect(visitorToken).toBeTruthy();
  return visitorToken;
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

test('authenticated beta-critical product flow works in production', async ({
  browser,
  baseURL
}) => {
  const fixture = loadFixture();
  const unique = `E2E-${fixture.runId}`;
  const novelTitle = `本番認証スモーク作品 ${unique}`;
  const episodeTitle = `第1話 本番認証スモーク ${unique}`;

  const authorContext = await browser.newContext({ baseURL });
  const readerContext = await browser.newContext({ baseURL });
  const authorPage = await authorContext.newPage();
  const readerPage = await readerContext.newPage();

  let novelId;
  let episodeHref;

  try {
    await test.step('Author login', async () => {
      const authorVisitorToken = await login(
        authorPage,
        fixture.author,
        'post.html'
      );
      saveVisitorToken('author', authorVisitorToken);
    });

    await test.step('Create novel', async () => {
      await authorPage.locator('#title').fill(novelTitle);
      await authorPage.locator('#genre').selectOption({ label: '現代ドラマ' });
      await authorPage
        .locator('#description')
        .fill(
          'β公開前の認証済み本番スモーク専用作品です。テスト終了時に自動削除されます。'
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
      await authorPage.locator('#title').fill(episodeTitle);
      await authorPage
        .locator('#content')
        .fill(
          'これはNOVELIGHTの本番認証スモーク用本文です。読書画面と10秒読書記録を検証します。'
        );
      await publishButton.click();
      await authorPage.waitForURL(/\/novel\.html\?id=/);
      await expect(authorPage.locator('.title')).toHaveText(novelTitle);
      await expect(authorPage.locator('.episode-title').first()).toHaveText(
        episodeTitle
      );
      episodeHref = await authorPage
        .locator('.episode-title')
        .first()
        .getAttribute('href');
      expect(episodeHref).toMatch(/^episode\.html\?id=/);
    });

    await test.step('Reader login', async () => {
      const readerVisitorToken = await login(
        readerPage,
        fixture.reader,
        `novel.html?id=${encodeURIComponent(novelId)}`
      );
      saveVisitorToken('reader', readerVisitorToken);
      await expect(readerPage.locator('.title')).toHaveText(novelTitle);
    });

    await test.step('Favorite novel', async () => {
      const favoriteButton = readerPage.locator('#favoriteButton');
      await expect(favoriteButton).toBeVisible();
      await expect(favoriteButton).toHaveText(/お気に入り/);
      await favoriteButton.click();
      await expect(favoriteButton).toHaveText(/お気に入り済み/);
      await expect(readerPage.locator('#favoriteCount')).toHaveText('1');
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

    await test.step('Read episode and record engaged reading', async () => {
      await readerPage.goto(`/${episodeHref}`);
      await expect(readerPage.locator('#card h1')).toHaveText(episodeTitle);
      await expect(readerPage.locator('#card .content')).toContainText(
        '本番認証スモーク用本文'
      );
      await readerPage.waitForTimeout(10_500);
    });

    await test.step('Verify LIGHT ANALYTICS', async () => {
      await authorPage.goto('/analytics.html');
      await expect(
        authorPage.getByRole('heading', { name: 'LIGHT ANALYTICS' })
      ).toBeVisible();
      await expect(authorPage.locator('#novelCount')).toHaveText('1');
      await expect(authorPage.locator('#favoriteTotal')).toHaveText('1');
    });
  } finally {
    await closeContextSafely(authorContext);
    await closeContextSafely(readerContext);
  }
});
