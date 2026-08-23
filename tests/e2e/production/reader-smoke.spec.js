import { expect, test } from '@playwright/test';

const blockedWriteRpcs = new Set([
  'record_acquisition_touch',
  'record_beta_visit',
  'claim_user_acquisition',
  'record_reader_journey_event',
  'record_novel_impressions_v2',
  'record_neutral_search_impressions',
  'record_novel_exposure_conversion',
  'increment_novel_pv',
  'increment_episode_pv'
]);

async function suppressMeasurementWrites(page) {
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const url = new URL(route.request().url());
    const rpcName = url.pathname.split('/').pop();

    if (!blockedWriteRpcs.has(rpcName)) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: 'null'
    });
  });
}

test('production search can reach a real novel and episode without writing metrics', async ({
  page
}) => {
  await suppressMeasurementWrites(page);

  await page.goto('/search.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#resultCount')).not.toHaveText('読み込み中...', {
    timeout: 20_000
  });
  await expect(page.locator('#resultCount')).not.toHaveText('読み込みエラー');

  const cards = page.locator('.novel-card');
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  const novelHrefs = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')).filter(Boolean)
  );

  let episodeHref = null;

  for (const novelHref of novelHrefs.slice(0, 12)) {
    await page.goto(novelHref, { waitUntil: 'domcontentloaded' });

    const warningGate = page.locator('#warningGate.visible');
    if (await warningGate.isVisible().catch(() => false)) {
      await page.locator('#continueButton').click();
    }

    await expect(page.locator('#novelHeader')).not.toContainText('読み込み中...', {
      timeout: 20_000
    });

    const episodeLinks = page.locator('.episode-title');
    if ((await episodeLinks.count()) > 0) {
      episodeHref = await episodeLinks.first().getAttribute('href');
      break;
    }
  }

  expect(
    episodeHref,
    'at least one published work should expose an episode'
  ).toBeTruthy();

  await page.goto(episodeHref, { waitUntil: 'domcontentloaded' });

  const episodeWarning = page.locator('#warning.visible');
  if (await episodeWarning.isVisible().catch(() => false)) {
    await page.locator('#continue').click();
  }

  await expect(page.locator('#card h1')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#card .content')).toBeVisible();
  await expect(page.locator('#card .content')).not.toHaveText('');
});
