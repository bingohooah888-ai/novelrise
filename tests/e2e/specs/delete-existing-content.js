import { expect, test } from '../fixtures/diagnostic-fixture.js';

async function installDeletionSupabaseStub(page, overrides = {}) {
  await page.addInitScript((state) => {
    globalThis.__NOVELIGHT_DELETE_E2E_STATE__ = state;
    globalThis.__NOVELIGHT_DELETE_E2E_CALLS__ = [];
  }, overrides);

  await page.route(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
        (() => {
          const state = window.__NOVELIGHT_DELETE_E2E_STATE__ || {};
          const calls = window.__NOVELIGHT_DELETE_E2E_CALLS__ || [];
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms || 0));

          function errorFor(message) {
            return message ? { message } : null;
          }

          function hasOwn(object, key) {
            return Object.prototype.hasOwnProperty.call(object || {}, key);
          }

          function singleDataFor(table) {
            return hasOwn(state.singleData, table) ? state.singleData[table] : null;
          }

          function builder(table) {
            let operation = 'select';
            const api = {
              select() {
                return api;
              },
              insert(payload) {
                operation = 'insert';
                calls.push({ type: 'insert', table, payload });
                return api;
              },
              delete() {
                operation = 'delete';
                calls.push({ type: 'delete', table });
                return api;
              },
              eq(column, value) {
                calls.push({ type: 'eq', table, column, value, operation });
                return api;
              },
              order() {
                return api;
              },
              single: async () => ({
                data: singleDataFor(table),
                error: errorFor(state.singleErrors?.[table])
              }),
              maybeSingle: async () => ({ data: null, error: null }),
              then(resolve, reject) {
                const finish = async () => {
                  if (operation === 'delete') {
                    await wait(state.deleteDelayMs);
                    return {
                      data: null,
                      error: errorFor(state.deleteErrors?.[table])
                    };
                  }
                  if (operation === 'select') {
                    return {
                      data: state.tableData?.[table] || [],
                      error: errorFor(state.tableErrors?.[table])
                    };
                  }
                  return { data: null, error: null };
                };
                return finish().then(resolve, reject);
              }
            };
            return api;
          }

          const client = {
            auth: {
              getSession: async () => ({
                data: { session: state.session || null },
                error: null
              })
            },
            rpc: async (name, args) => {
              calls.push({ type: 'rpc', name, args });
              const rpcData = state.rpcData || {};
              return {
                data: hasOwn(rpcData, name) ? rpcData[name] : true,
                error: errorFor(state.rpcErrors?.[name])
              };
            },
            from: (table) => builder(table)
          };

          window.supabase = { createClient: () => client };
        })();
      `
      });
    }
  );
}

function novelState(overrides = {}) {
  return {
    session: { user: { id: 'author-e2e' } },
    deleteDelayMs: 300,
    singleData: {
      novels: {
        id: 'novel-delete-e2e',
        user_id: 'author-e2e',
        title: '削除テスト作品',
        genre: '現代ドラマ',
        description: '削除導線のテスト作品です。',
        ai_usage: 'human',
        content_rating: 'general',
        content_warnings: [],
        status: 'published',
        pv: 4,
        created_at: '2026-08-30T00:00:00Z'
      }
    },
    tableData: { episodes: [], novels: [] },
    rpcData: {
      novelight_public_profile: [{ display_name: 'E2E Author' }],
      novelight_favorite_count: 0,
      light_seed_status: {
        reason: 'own_novel',
        monthly_limit: 5,
        remaining_this_month: 5,
        total_seed_count: 0
      }
    },
    ...overrides
  };
}

function episodeState(overrides = {}) {
  return {
    session: { user: { id: 'author-e2e' } },
    deleteDelayMs: 300,
    singleData: {
      episodes: {
        id: 'episode-delete-e2e',
        novel_id: 'novel-parent-e2e',
        user_id: 'author-e2e',
        episode_number: 2,
        title: '削除テスト第2話',
        content: '削除導線のテスト本文です。',
        pv: 2,
        status: 'published'
      },
      novels: {
        id: 'novel-parent-e2e',
        title: '親作品',
        user_id: 'author-e2e',
        status: 'published',
        content_rating: 'general',
        content_warnings: []
      }
    },
    ...overrides
  };
}

async function deletionCalls(page) {
  return page.evaluate(() => globalThis.__NOVELIGHT_DELETE_E2E_CALLS__);
}

function deleteEvidenceFor(table, calls) {
  return {
    deleted: calls.some(
      (call) => call.type === 'delete' && call.table === table
    ),
    filters: calls
      .filter(
        (call) =>
          call.type === 'eq' &&
          call.table === table &&
          call.operation === 'delete'
      )
      .map(({ column, value }) => [column, value])
  };
}

test('destructive deletion controls stay unavailable to non-owners', async ({
  page
}) => {
  await installDeletionSupabaseStub(page, {
    ...episodeState(),
    session: { user: { id: 'reader-e2e' } },
    singleData: {
      ...episodeState().singleData,
      novels: {
        ...episodeState().singleData.novels,
        id: 'novel-delete-e2e',
        title: '削除テスト作品',
        description: '削除導線のテスト作品です。',
        genre: '現代ドラマ',
        ai_usage: 'human',
        pv: 4,
        created_at: '2026-08-30T00:00:00Z'
      }
    },
    tableData: { episodes: [] },
    rpcData: novelState().rpcData
  });

  await page.goto('/novel.html?id=novel-delete-e2e');
  await expect(page.locator('#deleteNovel')).toBeHidden();

  await page.goto('/episode.html?id=episode-delete-e2e');
  await expect(page.locator('#delete')).toHaveCount(0);

  const calls = await deletionCalls(page);
  expect(deleteEvidenceFor('novels', calls).deleted).toBe(false);
  expect(deleteEvidenceFor('episodes', calls).deleted).toBe(false);
});

test('novel deletion cancel leaves the work untouched', async ({ page }) => {
  await installDeletionSupabaseStub(page, novelState());
  await page.goto('/novel.html?id=novel-delete-e2e');
  await expect(page.locator('#deleteNovel')).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    await dialog.dismiss();
  });
  await page.locator('#deleteNovel').click();

  await expect(page.locator('#deleteNovel')).toBeEnabled();
  await expect(page).toHaveURL(/\/novel\.html\?id=novel-delete-e2e$/);
  const calls = await deletionCalls(page);
  expect(deleteEvidenceFor('novels', calls).deleted).toBe(false);
});

test('novel deletion is owner-scoped and redirects after success', async ({
  page
}) => {
  await installDeletionSupabaseStub(page, novelState());
  await page.goto('/novel.html?id=novel-delete-e2e');

  page.once('dialog', async (dialog) => dialog.accept());
  await page.locator('#deleteNovel').click();
  await expect(page.locator('#deleteNovel')).toBeDisabled();

  const evidence = deleteEvidenceFor('novels', await deletionCalls(page));
  expect(evidence.deleted).toBe(true);
  expect(evidence.filters).toEqual([
    ['id', 'novel-delete-e2e'],
    ['user_id', 'author-e2e']
  ]);

  await page.waitForURL(/\/my-novels\.html$/);
});

test('novel deletion recovers after an async failure', async ({ page }) => {
  await installDeletionSupabaseStub(
    page,
    novelState({ deleteErrors: { novels: 'temporary database error' } })
  );
  await page.goto('/novel.html?id=novel-delete-e2e');

  let resolveAlert;
  const alertMessage = new Promise((resolve) => {
    resolveAlert = resolve;
  });
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'confirm') {
      await dialog.accept();
      return;
    }
    resolveAlert(dialog.message());
    await dialog.accept();
  });

  await page.locator('#deleteNovel').click();
  await expect(page.locator('#deleteNovel')).toBeDisabled();
  expect(await alertMessage).toBe(
    '作品を削除できませんでした。時間をおいて再度お試しください。'
  );
  await expect(page.locator('#deleteNovel')).toBeEnabled();
  await expect(page).toHaveURL(/\/novel\.html\?id=novel-delete-e2e$/);

  const evidence = deleteEvidenceFor('novels', await deletionCalls(page));
  expect(evidence.filters).toEqual([
    ['id', 'novel-delete-e2e'],
    ['user_id', 'author-e2e']
  ]);
});

test('episode deletion cancel leaves the episode untouched', async ({ page }) => {
  await installDeletionSupabaseStub(page, episodeState());
  await page.goto('/episode.html?id=episode-delete-e2e');
  await expect(page.locator('#delete')).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    await dialog.dismiss();
  });
  await page.locator('#delete').click();

  await expect(page.locator('#delete')).toBeEnabled();
  await expect(page).toHaveURL(/\/episode\.html\?id=episode-delete-e2e$/);
  const calls = await deletionCalls(page);
  expect(deleteEvidenceFor('episodes', calls).deleted).toBe(false);
});

test('episode deletion is owner-scoped and redirects after success', async ({
  page
}) => {
  await installDeletionSupabaseStub(page, episodeState());
  await page.goto('/episode.html?id=episode-delete-e2e');

  page.once('dialog', async (dialog) => dialog.accept());
  await page.locator('#delete').click();
  await expect(page.locator('#delete')).toBeDisabled();

  const evidence = deleteEvidenceFor('episodes', await deletionCalls(page));
  expect(evidence.deleted).toBe(true);
  expect(evidence.filters).toEqual([
    ['id', 'episode-delete-e2e'],
    ['user_id', 'author-e2e']
  ]);

  await page.waitForURL(/\/novel\.html\?id=novel-parent-e2e$/);
});

test('episode deletion recovers after an async failure', async ({ page }) => {
  await installDeletionSupabaseStub(
    page,
    episodeState({ deleteErrors: { episodes: 'temporary database error' } })
  );
  await page.goto('/episode.html?id=episode-delete-e2e');

  let resolveAlert;
  const alertMessage = new Promise((resolve) => {
    resolveAlert = resolve;
  });
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'confirm') {
      await dialog.accept();
      return;
    }
    resolveAlert(dialog.message());
    await dialog.accept();
  });

  await page.locator('#delete').click();
  await expect(page.locator('#delete')).toBeDisabled();
  expect(await alertMessage).toBe(
    '削除できませんでした。時間をおいて再度お試しください。'
  );
  await expect(page.locator('#delete')).toBeEnabled();
  await expect(page).toHaveURL(/\/episode\.html\?id=episode-delete-e2e$/);

  const evidence = deleteEvidenceFor('episodes', await deletionCalls(page));
  expect(evidence.filters).toEqual([
    ['id', 'episode-delete-e2e'],
    ['user_id', 'author-e2e']
  ]);
});
