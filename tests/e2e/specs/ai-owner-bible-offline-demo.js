// Local static-server fixture only: real author UI logic + injected fake GET.
// No hosted traffic, tokens, account access, database writes, or AI provider.
import { expect, test } from '../fixtures/diagnostic-fixture.js';

async function openOfflineAuthorPage(page) {
  const externalCalls = [];
  page.on('request', (request) => {
    if (/\/(api)\/|supabase\.co|openai\.com/i.test(request.url())) {
      externalCalls.push(request.url());
    }
  });
  await page.route('**/api/**', (route) => route.abort('blockedbyclient'));
  await page.route('**/*.supabase.co/**', (route) =>
    route.abort('blockedbyclient')
  );
  await page.goto('/tests/e2e/fixtures/ai-owner-bible-offline-demo.html', {
    waitUntil: 'domcontentloaded'
  });
  await expect(
    page.getByRole('heading', { name: '創作室 › 作品カルテ' })
  ).toBeVisible();
  return externalCalls;
}

test('offline author page loads the existing Novel Bible view and reloads', async ({
  page
}) => {
  const external = await openOfflineAuthorPage(page);
  const reader = page.locator('#offline-author-bible');
  await expect(reader.locator('.novelight-ai-bible-load-status')).toContainText(
    'まだ読み込まれていません'
  );
  await reader.getByRole('button', { name: '読み込む' }).click();
  await expect(reader.locator('.novelight-ai-bible-load-status')).toContainText(
    '作品カルテを読み込みました'
  );
  await expect(reader).toContainText('凛');
  await expect(reader).toContainText('第1話');
  await expect(reader).toContainText('第2話');
  await expect(reader).toContainText('青い鍵');
  await expect(reader.getByRole('button', { name: '再読込' })).toBeEnabled();
  await reader.getByRole('button', { name: '再読込' }).click();
  await expect(reader.locator('.novelight-ai-bible-load-status')).toContainText(
    '作品カルテを読み込みました'
  );
  const state = await page.evaluate(() => ({
    reads: globalThis.NovelightAiBibleOfflineDemo.previewReads,
    outlines: globalThis.NovelightAiBibleOfflineDemo.outlineReads
  }));
  expect(state).toEqual({ reads: 2, outlines: 2 });
  expect(external).toEqual([]);
});

test('offline author page recovers from empty results and synthetic errors', async ({
  page
}) => {
  const external = await openOfflineAuthorPage(page);
  const reader = page.locator('#offline-author-bible');
  await reader.getByRole('button', { name: '読み込む' }).click();
  await expect(reader).toContainText('主人公が青い鍵を見つける');

  await page.getByRole('button', { name: '空結果で読込' }).click();
  await expect(reader.locator('.novelight-ai-bible-load-status')).toContainText(
    '登録情報はまだありません'
  );
  await expect(reader).not.toContainText('主人公が青い鍵を見つける');
  await expect(
    reader.locator('.novelight-ai-bible-private-content')
  ).toBeVisible();

  await page.getByRole('button', { name: 'エラーを再現' }).click();
  await expect(reader.locator('.novelight-ai-bible-load-status')).toContainText(
    '読み込みに失敗しました。再読込してください'
  );
  await expect(
    reader.locator('.novelight-ai-bible-private-content')
  ).toBeHidden();
  await expect(reader).not.toContainText('SYNTHETIC_OFFLINE_FAILURE');
  await expect(reader).not.toContainText('主人公が青い鍵を見つける');

  await page.getByRole('button', { name: '復旧して再読込' }).click();
  await expect(reader.locator('.novelight-ai-bible-load-status')).toContainText(
    '作品カルテを読み込みました'
  );
  await expect(reader).toContainText('復旧した模擬設定：新しい朝に旅が始まる');
  await expect(
    page.getByRole('button', { name: '復旧して再読込' })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(reader).not.toContainText('SYNTHETIC_OFFLINE_FAILURE');

  const state = await page.evaluate(() => ({
    mode: globalThis.NovelightAiBibleOfflineDemo.scenario,
    reads: globalThis.NovelightAiBibleOfflineDemo.previewReads
  }));
  expect(state).toEqual({ mode: 'recovery', reads: 4 });
  expect(external).toEqual([]);
});
