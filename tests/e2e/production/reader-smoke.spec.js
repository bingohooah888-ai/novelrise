import { URL } from 'node:url';
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

function novelIdFromHref(href) {
  return new URL(href, 'https://novelight.invalid').searchParams.get('id');
}

async function findPublishedEpisode(page, novelHrefs) {
  const novelIds = novelHrefs
    .slice(0, 24)
    .map(novelIdFromHref)
    .filter(Boolean);

  expect(novelIds.length).toBeGreaterThan(0);

  const scriptText = (await page.locator('script').allTextContents()).join(
    '\n'
  );
  const configMatch = scriptText.match(
    /supabase\.createClient\('([^']+)','([^']+)'\)/
  );

  expect(
    configMatch,
    'search page should expose its public Supabase client configuration'
  ).toBeTruthy();

  const [, supabaseUrl, publishableKey] = configMatch;
  const response = await page.request.get(`${supabaseUrl}/rest/v1/episodes`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`
    },
    params: {
      select: 'id,novel_id',
      novel_id: `in.(${novelIds.join(',')})`,
      status: 'eq.published',
      limit: '1'
    }
  });

  expect(response.ok()).toBeTruthy();
  const rows = await response.json();
  return rows[0] ?? null;
}

test('production reader flow is healthy and read-only', async ({ page }) => {
  await suppressMeasurementWrites(page);

  await page.goto('/search.html', { waitUntil: 'domcontentloaded' });
  const resultCount = page.locator('#resultCount');
  await expect(resultCount).not.toHaveText('読み込み中...', {
    timeout: 20_000
  });
  await expect(resultCount).not.toHaveText('読み込みエラー');

  const cards = page.locator('.novel-card');
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  const novelHrefs = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')).filter(Boolean)
  );

  const episode = await findPublishedEpisode(page, novelHrefs);
  expect(
    episode,
    'at least one published search result should expose a published episode'
  ).toBeTruthy();

  const novelHref = novelHrefs.find(
    (href) => novelIdFromHref(href) === String(episode.novel_id)
  );
  expect(novelHref).toBeTruthy();

  await page.goto(novelHref, { waitUntil: 'domcontentloaded' });

  const warningGate = page.locator('#warningGate.visible');
  if (await warningGate.isVisible().catch(() => false)) {
    await page.locator('#continueButton').click();
  }

  const novelHeader = page.locator('#novelHeader');
  await expect(novelHeader).not.toContainText('読み込み中...', {
    timeout: 20_000
  });

  const episodeHref = await page.locator('.episode-title').evaluateAll(
    (nodes, expectedEpisodeId) =>
      nodes
        .map((node) => node.getAttribute('href'))
        .find(
          (href) =>
            href &&
            new globalThis.URL(href, globalThis.location.href).searchParams.get(
              'id'
            ) === expectedEpisodeId
        ) ?? null,
    String(episode.id)
  );

  expect(
    episodeHref,
    'selected episode should appear on its novel page'
  ).toBeTruthy();

  await page.goto(episodeHref, { waitUntil: 'domcontentloaded' });

  const episodeWarning = page.locator('#warning.visible');
  if (await episodeWarning.isVisible().catch(() => false)) {
    await page.locator('#continue').click();
  }

  await expect(page.locator('#card h1')).toBeVisible({ timeout: 20_000 });
  const content = page.locator('#card .content');
  await expect(content).toBeVisible();
  await expect(content).not.toHaveText('');
});
