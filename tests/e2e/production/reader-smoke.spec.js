import { URL } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  SEARCH_EMPTY_MESSAGE,
  resolveSearchCatalogState
} from './search-catalog-state.js';

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
  await page.route('**/api/analytics-event', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"accepted":false,"recorded_count":0}'
    });
  });

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

function resourceIdFromHref(href) {
  return new URL(href, 'https://novelight.invalid').searchParams.get('id');
}

async function findPublishedEpisode(page, novelHrefs) {
  const novelIds = novelHrefs
    .slice(0, 24)
    .map(resourceIdFromHref)
    .filter(Boolean);

  expect(novelIds.length).toBeGreaterThan(0);

  const scripts = await page.locator('script').allTextContents();
  const scriptText = scripts.join('\n');
  const clientPattern = /supabase\.createClient\('([^']+)','([^']+)'\)/;
  const configMatch = scriptText.match(clientPattern);

  expect(configMatch).toBeTruthy();

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

function installReaderDiagnostics(page) {
  const pageErrors = [];
  const consoleErrors = [];
  const outlineResponses = [];

  page.on('pageerror', (error) => {
    pageErrors.push(String(error?.stack || error?.message || error));
  });

  page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    consoleErrors.push(`${message.type()}: ${message.text()}`);
  });

  page.on('response', async (response) => {
    if (!response.url().includes('/rpc/novelight_novel_outline')) return;
    outlineResponses.push({
      status: response.status(),
      body: await response.text().catch(() => '<unavailable>')
    });
  });

  return async (stage) => {
    const browserState = await page
      .evaluate(() => {
        const snapshot = (selector) => {
          const element = globalThis.document.querySelector(selector);
          if (!element) return null;
          const style = globalThis.getComputedStyle(element);
          return {
            html: element.outerHTML.slice(0, 5000),
            display: style.display,
            visibility: style.visibility
          };
        };

        return {
          url: globalThis.location.href,
          readyState: globalThis.document.readyState,
          bodyClass: globalThis.document.body?.className || '',
          novelHeader: snapshot('#novelHeader'),
          favoriteButton: snapshot('#favoriteButton'),
          episodesPanel: snapshot('#episodesPanel'),
          episodeList: snapshot('#episodeList'),
          v2Grid: snapshot('.nl-work-detail-grid'),
          hasNovelDetailV2: Boolean(globalThis.NovelightNovelDetailV2),
          scripts: Array.from(globalThis.document.scripts).map(
            (script) => script.src || '[inline]'
          )
        };
      })
      .catch((error) => ({ evaluationError: String(error) }));

    console.error(
      '[production-reader-diagnostic]',
      JSON.stringify(
        {
          stage,
          pageErrors,
          consoleErrors,
          outlineResponses,
          browserState
        },
        null,
        2
      )
    );
  };
}

async function novelReaderReady(page) {
  const v2Surface = page.locator('.nl-work-detail-grid');
  if (await v2Surface.isVisible().catch(() => false)) return true;

  const hydratedFavorite = page.locator('#favoriteButton');
  if ((await hydratedFavorite.count()) < 1) return false;

  const novelHeader = page.locator('#novelHeader');
  const headerText = await novelHeader.textContent().catch(() => '');
  return Boolean(headerText && !headerText.includes('読み込み中...'));
}

async function unlockNovelWarningIfNeeded(page) {
  const warningGate = page.locator('#warningGate');

  await expect
    .poll(
      async () => {
        if (await warningGate.isVisible().catch(() => false)) return true;
        return novelReaderReady(page);
      },
      { timeout: 20_000 }
    )
    .toBe(true);

  if (await warningGate.isVisible()) {
    await page.locator('#continueButton').click();
    await expect
      .poll(() => novelReaderReady(page), { timeout: 20_000 })
      .toBe(true);
  }
}

async function episodeReaderReady(page) {
  const warning = page.locator('#warning.visible');
  if (await warning.isVisible().catch(() => false)) return true;
  return page
    .locator('#report')
    .isVisible()
    .catch(() => false);
}

test('production reader flow is healthy and read-only', async ({ page }) => {
  test.setTimeout(120_000);
  await suppressMeasurementWrites(page);
  const dumpDiagnostics = installReaderDiagnostics(page);

  await page.goto('/search.html', {
    waitUntil: 'domcontentloaded',
    timeout: 20_000
  });
  const resultCount = page.locator('#resultCount');
  await expect(resultCount).not.toHaveText('読み込み中...', {
    timeout: 20_000
  });
  await expect(resultCount).not.toHaveText('読み込みエラー');

  const cards = page.locator('.novel-card');
  const emptyStates = page.locator('#novelList .empty');
  const catalogState = resolveSearchCatalogState({
    resultText: await resultCount.textContent(),
    cardCount: await cards.count(),
    emptyText:
      (await emptyStates.count()) > 0
        ? await emptyStates.first().textContent()
        : null
  });

  if (catalogState === 'empty') {
    await expect(emptyStates.first()).toHaveText(SEARCH_EMPTY_MESSAGE);
    if (process.env.NOVELIGHT_REQUIRE_PUBLISHED_CATALOG === '1') {
      throw new Error(
        'The beta inventory gate requires at least one published work with a published episode.'
      );
    }
    return;
  }

  await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  const novelHrefs = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')).filter(Boolean)
  );

  const episode = await findPublishedEpisode(page, novelHrefs);
  expect(episode).toBeTruthy();

  const novelHref = novelHrefs.find(
    (href) => resourceIdFromHref(href) === String(episode.novel_id)
  );
  expect(novelHref).toBeTruthy();

  await page.goto(novelHref, {
    waitUntil: 'domcontentloaded',
    timeout: 20_000
  });
  try {
    await unlockNovelWarningIfNeeded(page);
  } catch (error) {
    await dumpDiagnostics('novel-reader-ready');
    throw error;
  }

  const readerSurface = page
    .locator('.nl-work-detail-grid, #episodesPanel')
    .first();
  await expect(readerSurface).toBeVisible({ timeout: 20_000 });

  const episodeLinks = page.locator(
    '.nl-work-detail-toc .nl-work-toc-link, #episodeList .episode-title'
  );
  try {
    await expect(episodeLinks.first()).toBeVisible({ timeout: 20_000 });
  } catch (error) {
    await dumpDiagnostics('novel-episode-links');
    throw error;
  }

  const episodeHrefs = await episodeLinks.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')).filter(Boolean)
  );
  const episodeHref = episodeHrefs.find(
    (href) => resourceIdFromHref(href) === String(episode.id)
  );
  expect(episodeHref).toBeTruthy();

  await page.goto(episodeHref, {
    waitUntil: 'commit',
    timeout: 20_000
  });
  try {
    await expect
      .poll(() => episodeReaderReady(page), { timeout: 20_000 })
      .toBe(true);
  } catch (error) {
    await dumpDiagnostics('episode-reader-ready');
    throw error;
  }

  const episodeWarning = page.locator('#warning.visible');
  if (await episodeWarning.isVisible().catch(() => false)) {
    await page.locator('#continue').click();
  }

  await expect(page.locator('#report')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#card h1')).toBeVisible({ timeout: 20_000 });
  const content = page.locator('#card .content');
  await expect(content).toBeVisible();
  await expect(content).not.toHaveText('');
});
