import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const PRODUCTION_SUPABASE_HOST = 'fiepaguycecrredwrcwx.supabase.co';
const BUCKET = 'novel-thumbnails';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
}

const stagingTarget = new URL(supabaseUrl);
if (
  stagingTarget.protocol !== 'https:' ||
  !stagingTarget.hostname.endsWith('.supabase.co') ||
  stagingTarget.hostname === PRODUCTION_SUPABASE_HOST
) {
  throw new Error(
    'Thumbnail Staging smoke refuses a non-Staging Supabase target.'
  );
}

const stagingProjectRef = stagingTarget.hostname.split('.')[0];
const admin = createClient(stagingTarget.origin, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function assertNoError(result, label) {
  if (result?.error) throw new Error(`${label}: ${result.error.message}`);
  return result?.data;
}

function password() {
  return `Nl!${randomBytes(24).toString('base64url')}9a`;
}

async function waitForProfile(userId) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const result = await admin.from('profiles').select('id').eq('id', userId);
    assertNoError(result, 'read thumbnail smoke profile');
    if ((result.data || []).length === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Thumbnail smoke profile was not created in time.');
}

async function deleteByIds(table, column, values) {
  const ids = [...new Set((values || []).filter(Boolean).map(String))];
  if (!ids.length) return;
  assertNoError(
    await admin.from(table).delete().in(column, ids),
    `cleanup ${table}`
  );
}

async function cleanupFixture(fixture) {
  const errors = [];
  const attempt = async (label, action) => {
    try {
      await action();
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  };

  const userId = fixture.user?.id;
  const novelId = fixture.novelId;
  const assetId = fixture.assetId;

  await attempt('cleanup novel-linked records', async () => {
    if (!novelId) return;
    await deleteByIds('novel_allocation_receipts', 'novel_id_snapshot', [
      novelId
    ]);
    await deleteByIds('novel_exposure_conversions', 'novel_id_snapshot', [
      novelId
    ]);
    await deleteByIds('novel_exposure_events', 'novel_id_snapshot', [novelId]);
    await deleteByIds('reader_journey_events', 'novel_id_snapshot', [novelId]);
    await deleteByIds('light_seeds', 'novel_id_snapshot', [novelId]);
    await deleteByIds('favorites', 'novel_id', [novelId]);
    await deleteByIds('content_reports', 'novel_id_snapshot', [novelId]);
    await deleteByIds('episodes', 'novel_id', [novelId]);
    await deleteByIds('novels', 'id', [novelId]);
  });

  await attempt('cleanup thumbnail audit', async () => {
    if (!assetId) return;
    await deleteByIds('admin_operation_audit', 'resource_id', [assetId]);
  });

  await attempt('cleanup thumbnail asset', async () => {
    if (!assetId) return;
    await deleteByIds('novel_thumbnail_assets', 'id', [assetId]);
  });

  await attempt('cleanup thumbnail storage object', async () => {
    if (!fixture.storagePath) return;
    assertNoError(
      await admin.storage.from(BUCKET).remove([fixture.storagePath]),
      'remove thumbnail smoke object'
    );
  });

  await attempt('cleanup user-linked rows', async () => {
    if (!userId) return;
    await deleteByIds('founding_authors', 'author_id', [userId]);
    await deleteByIds('founding_author_exclusion_audit', 'author_id', [userId]);
    await deleteByIds('founding_author_exclusions', 'user_id', [userId]);
    await deleteByIds('user_acquisition', 'user_id', [userId]);
    await deleteByIds('user_lifecycle', 'user_id', [userId]);
    await deleteByIds('beta_activity_days', 'user_id', [userId]);
    await deleteByIds('acquisition_touches', 'user_id', [userId]);
    await deleteByIds('profiles', 'id', [userId]);
  });

  await attempt('cleanup auth user', async () => {
    if (!userId) return;
    const result = await admin.auth.admin.deleteUser(userId);
    if (result.error && !/not found/iu.test(result.error.message || '')) {
      throw result.error;
    }
  });

  if (errors.length) {
    throw new Error(`Thumbnail smoke cleanup failed: ${errors.join(' | ')}`);
  }
}

async function createFixture() {
  const runId = String(process.env.GITHUB_RUN_ID || Date.now());
  const suffix = randomBytes(4).toString('hex');
  const userPassword = password();
  const email = `novelight-thumbnail-e2e-${runId}-${suffix}@example.com`;
  const displayName = `NOVELIGHT Thumbnail E2E ${runId}`;
  const assetLabel = `Staging Thumbnail ${runId}-${suffix}`;
  const storagePath = `official/${randomUUID()}.webp`;
  const fixture = {
    user: null,
    password: userPassword,
    assetLabel,
    assetId: null,
    storagePath,
    publicUrl: null,
    novelId: null
  };

  const userData = assertNoError(
    await admin.auth.admin.createUser({
      email,
      password: userPassword,
      email_confirm: true,
      user_metadata: { display_name: displayName, internal_e2e: true }
    }),
    'create thumbnail smoke author'
  );
  fixture.user = {
    id: userData.user.id,
    email,
    displayName
  };

  await waitForProfile(fixture.user.id);
  assertNoError(
    await admin.from('founding_author_exclusions').upsert(
      {
        user_id: fixture.user.id,
        reason: 'automated staging thumbnail smoke'
      },
      { onConflict: 'user_id' }
    ),
    'exclude thumbnail smoke author from Founding Authors'
  );

  const fileBuffer = readFileSync(
    new URL('../../../assets/novelight-header-logo.webp', import.meta.url)
  );
  const uploadBody = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );
  assertNoError(
    await admin.storage.from(BUCKET).upload(storagePath, uploadBody, {
      contentType: 'image/webp',
      upsert: false
    }),
    'upload thumbnail smoke object'
  );

  const publicData = admin.storage.from(BUCKET).getPublicUrl(storagePath).data;
  if (!publicData?.publicUrl?.startsWith('https://')) {
    throw new Error('Thumbnail smoke public URL was unavailable.');
  }
  fixture.publicUrl = publicData.publicUrl;

  const registered = assertNoError(
    await admin.rpc('novelight_admin_register_thumbnail_asset', {
      p_admin_user_id: fixture.user.id,
      p_label: assetLabel,
      p_storage_path: storagePath,
      p_image_url: fixture.publicUrl
    }),
    'register official thumbnail through ADMIN RPC'
  );
  fixture.assetId = Array.isArray(registered)
    ? registered[0]?.id
    : registered?.id;
  if (!fixture.assetId) {
    throw new Error('Thumbnail ADMIN registration returned no asset ID.');
  }

  const audit = assertNoError(
    await admin
      .from('admin_operation_audit')
      .select('action,resource_type,resource_id')
      .eq('resource_id', String(fixture.assetId))
      .eq('action', 'thumbnail.create')
      .single(),
    'verify thumbnail ADMIN audit'
  );
  expect(audit).toMatchObject({
    action: 'thumbnail.create',
    resource_type: 'novel_thumbnail_asset',
    resource_id: String(fixture.assetId)
  });

  return fixture;
}

async function assertStagingSession(page) {
  const authKeys = await page.evaluate(() => {
    const keys = [];
    for (let index = 0; index < globalThis.localStorage.length; index += 1) {
      const key = globalThis.localStorage.key(index);
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) keys.push(key);
    }
    return keys;
  });
  expect(authKeys).toContain(`sb-${stagingProjectRef}-auth-token`);
  expect(authKeys).not.toContain('sb-fiepaguycecrredwrcwx-auth-token');
}

async function assertCardThumbnail(card, publicUrl) {
  await expect(card).toBeVisible({ timeout: 20_000 });
  const image = card.locator('.novelight-official-thumbnail img');
  await expect(image).toBeVisible({ timeout: 20_000 });
  await expect(image).toHaveAttribute('src', publicUrl);
}

test('official thumbnail survives Staging registration, author selection, publish, and discovery surfaces', async ({
  page
}) => {
  test.setTimeout(150_000);
  const fixture = await createFixture();
  const unique = `${process.env.GITHUB_RUN_ID || Date.now()}-${randomBytes(
    3
  ).toString('hex')}`;
  const novelTitle = `サムネイルE2E作品 ${unique}`;

  try {
    await test.step('Author selects the registered official thumbnail', async () => {
      await page.goto(
        `/login.html?redirect=${encodeURIComponent('post.html')}`
      );
      await page.locator('#email').fill(fixture.user.email);
      await page.locator('#password').fill(fixture.password);
      await page.locator('#loginButton').click();
      await page.waitForURL((url) => url.pathname.endsWith('/post.html'));
      await assertStagingSession(page);

      const thumbnailInput = page.locator(
        `input[name="thumbnailAsset"][value="${fixture.assetId}"]`
      );
      await expect(
        page.getByText(fixture.assetLabel, { exact: true })
      ).toBeVisible();
      await page.getByText(fixture.assetLabel, { exact: true }).click();
      await expect(thumbnailInput).toBeChecked();

      await page.locator('#title').fill(novelTitle);
      await page.locator('#genre').selectOption({ label: '現代ドラマ' });
      await page
        .locator('#description')
        .fill('公式サムネイルのStaging実動作を検証する一時作品です。');
      await page.locator('#aiUsage').selectOption('human');
      await page.locator('#contentRating').selectOption('general');
      await page.locator('#policyAck').check();
      await expect(page.locator('#submitButton')).toBeEnabled();
      await page.locator('#submitButton').click();
      await page.waitForURL(/\/episode-post\.html\?novel_id=/u);

      fixture.novelId = new URL(page.url()).searchParams.get('novel_id');
      expect(fixture.novelId).toBeTruthy();
    });

    await test.step('Publish the first episode and verify persisted thumbnail linkage', async () => {
      await expect(page.locator('#publish')).toBeEnabled();
      await page.locator('#episodeNumber').fill('1');
      await page.locator('#title').fill('第1話 サムネイル表示確認');
      await page
        .locator('#content')
        .fill(
          'NOVELIGHT公式サムネイルの表示経路を確認するStaging専用本文です。'
        );
      await page.locator('#publish').click();
      await page.waitForURL(/\/novel\.html\?id=/u);

      const novel = assertNoError(
        await admin
          .from('novels')
          .select('id,thumbnail_asset_id,thumbnail_url,status')
          .eq('id', fixture.novelId)
          .single(),
        'read published thumbnail smoke novel'
      );
      expect(String(novel.thumbnail_asset_id)).toBe(String(fixture.assetId));
      expect(novel.thumbnail_url).toBe(fixture.publicUrl);
      expect(novel.status).toBe('published');
    });

    await test.step('Home new arrivals shows the official thumbnail', async () => {
      await page.goto('/index.html');
      const card = page.locator(
        `#newGrid a.novel-card[href="novel.html?id=${fixture.novelId}"]`
      );
      await assertCardThumbnail(card, fixture.publicUrl);
    });

    await test.step('Search shows the same official thumbnail', async () => {
      await page.goto('/search.html?sort=new');
      await page.locator('#keywordInput').fill(novelTitle);
      const card = page.locator(
        `#novelList a.novel-card[href="novel.html?id=${fixture.novelId}"]`
      );
      await assertCardThumbnail(card, fixture.publicUrl);
    });

    await test.step('Ranking new tab shows the same official thumbnail', async () => {
      await page.goto('/ranking.html');
      await page.locator('.tab[data-type="new"]').click();
      const card = page.locator(
        `#list a.card[href="novel.html?id=${fixture.novelId}"]`
      );
      await assertCardThumbnail(card, fixture.publicUrl);
    });
  } finally {
    await cleanupFixture(fixture);
  }
});
