import { expect, test } from '../fixtures/diagnostic-fixture.js';

async function installEditSupabaseStub(page, overrides = {}) {
  await page.addInitScript((state) => {
    globalThis.__NOVELIGHT_EDIT_E2E_STATE__ = state;
    globalThis.__NOVELIGHT_EDIT_E2E_CALLS__ = [];
  }, overrides);

  await page.route(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
        (() => {
          const state = window.__NOVELIGHT_EDIT_E2E_STATE__ || {};
          const calls = window.__NOVELIGHT_EDIT_E2E_CALLS__ || [];
          const storedTableKey = '__novelight_edit_e2e_tables__';
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms || 0));

          function errorFor(message) {
            return message ? { message } : null;
          }

          function hasOwn(object, key) {
            return Object.prototype.hasOwnProperty.call(object || {}, key);
          }

          function readStoredTables() {
            try {
              return JSON.parse(sessionStorage.getItem(storedTableKey) || '{}');
            } catch {
              return {};
            }
          }

          function writeStoredTables(tables) {
            sessionStorage.setItem(storedTableKey, JSON.stringify(tables));
          }

          function singleDataFor(table) {
            const storedTables = readStoredTables();
            if (hasOwn(storedTables, table)) return storedTables[table];
            if (hasOwn(state.singleData, table)) return state.singleData[table];
            return null;
          }

          function persistUpdate(table, payload) {
            const storedTables = readStoredTables();
            storedTables[table] = {
              ...(singleDataFor(table) || {}),
              ...(payload || {})
            };
            writeStoredTables(storedTables);
          }

          function builder(table) {
            let operation = 'select';
            let mutationPayload = null;
            const api = {
              select() {
                return api;
              },
              update(payload) {
                operation = 'update';
                mutationPayload = payload;
                calls.push({ type: 'update', table, payload });
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
                  if (operation === 'update') {
                    await wait(state.updateDelayMs);
                    const error = errorFor(state.updateErrors?.[table]);
                    if (!error) persistUpdate(table, mutationPayload);
                    return { data: null, error };
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

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

function updateEvidenceFor(table, calls) {
  return {
    update: calls.find(
      (call) => call.type === 'update' && call.table === table
    ),
    filters: calls
      .filter(
        (call) =>
          call.type === 'eq' &&
          call.table === table &&
          call.operation === 'update'
      )
      .map(({ column, value }) => [column, value])
  };
}

test('novel edit loads existing work, saves changes, and renders the update', async ({
  page
}) => {
  await installEditSupabaseStub(page, {
    session: { user: { id: 'author-e2e' } },
    updateDelayMs: 300,
    singleData: {
      novels: {
        id: 'novel-edit-e2e',
        user_id: 'author-e2e',
        title: '編集前の作品',
        genre: '現代ドラマ',
        description: '編集前のあらすじです。',
        ai_usage: 'human',
        content_rating: 'general',
        content_warnings: [],
        content_policy_ack: true,
        status: 'published',
        pv: 4,
        created_at: '2026-08-30T00:00:00Z'
      }
    },
    rpcData: {
      novelight_public_profile: [{ display_name: 'E2E Author' }],
      novelight_favorite_count: 0,
      light_seed_status: {
        reason: 'own_novel',
        monthly_limit: 5,
        remaining_this_month: 5,
        total_seed_count: 0
      }
    }
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/novel-edit.html?id=novel-edit-e2e');
  await expect(page.locator('#title')).toHaveValue('編集前の作品');
  await expect(page.locator('#description')).toHaveValue('編集前のあらすじです。');
  await expect(page.locator('#aiUsage')).toHaveValue('human');
  await expect(page.locator('#save')).toBeEnabled();

  await page.locator('#title').fill('編集後の作品');
  await page.locator('#description').fill('編集後のあらすじです。');
  await page.locator('#aiUsage').selectOption('ai_assisted');
  await page.locator('#contentRating').selectOption('mature');
  await page.locator('#warningGrid input[value="violence"]').check();
  await page.locator('#save').click();

  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#status')).toHaveText('保存しています...');

  const evidence = await page.evaluate(() => {
    const calls = globalThis.__NOVELIGHT_EDIT_E2E_CALLS__;
    return {
      update: calls.find(
        (call) => call.type === 'update' && call.table === 'novels'
      ),
      filters: calls
        .filter(
          (call) =>
            call.type === 'eq' &&
            call.table === 'novels' &&
            call.operation === 'update'
        )
        .map(({ column, value }) => [column, value])
    };
  });
  expect(evidence.update?.payload).toMatchObject({
    title: '編集後の作品',
    description: '編集後のあらすじです。',
    ai_usage: 'ai_assisted',
    content_rating: 'mature',
    content_warnings: ['violence'],
    content_policy_ack: true
  });
  expect(evidence.filters).toEqual([
    ['id', 'novel-edit-e2e'],
    ['user_id', 'author-e2e']
  ]);

  await page.waitForURL(/\/novel\.html\?id=novel-edit-e2e$/);
  await expect(page.locator('.title')).toHaveText('編集後の作品');
  await expect(page.locator('.description')).toHaveText('編集後のあらすじです。');
  await expect(page.locator('.tag.ai')).toHaveText('AI支援');
  expect(pageErrors).toEqual([]);
});

test('novel edit recovers after an async save failure', async ({ page }) => {
  await installEditSupabaseStub(page, {
    session: { user: { id: 'author-e2e' } },
    updateDelayMs: 300,
    updateErrors: { novels: 'temporary database error' },
    singleData: {
      novels: {
        id: 'novel-edit-failure-e2e',
        user_id: 'author-e2e',
        title: '保存失敗前の作品',
        genre: '現代ドラマ',
        description: '保存失敗テストのあらすじです。',
        ai_usage: 'human',
        content_rating: 'general',
        content_warnings: [],
        content_policy_ack: true
      }
    }
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/novel-edit.html?id=novel-edit-failure-e2e');
  await expect(page.locator('#save')).toBeEnabled();
  await page.locator('#title').fill('保存に失敗する作品');
  await page.locator('#save').click();

  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#status')).toHaveText('保存しています...');
  await expect(page.locator('#status')).toHaveText(
    '保存できませんでした。時間をおいて再度お試しください。'
  );
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page).toHaveURL(/\/novel-edit\.html\?id=novel-edit-failure-e2e$/);

  const calls = await page.evaluate(() => globalThis.__NOVELIGHT_EDIT_E2E_CALLS__);
  expect(updateEvidenceFor('novels', calls).update).toBeTruthy();
  expect(pageErrors).toEqual([]);
});

test('episode edit loads existing episode, saves changes, and renders the update', async ({
  page
}) => {
  await installEditSupabaseStub(page, {
    session: { user: { id: 'author-e2e' } },
    updateDelayMs: 300,
    singleData: {
      episodes: {
        id: 'episode-edit-e2e',
        novel_id: 'novel-for-episode-e2e',
        user_id: 'author-e2e',
        episode_number: 2,
        title: '編集前の第2話',
        content: '編集前の本文です。',
        pv: 2,
        status: 'published'
      },
      novels: {
        id: 'novel-for-episode-e2e',
        title: '親作品',
        user_id: 'author-e2e',
        status: 'published',
        content_rating: 'general',
        content_warnings: []
      }
    }
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/episode-edit.html?id=episode-edit-e2e');
  await expect(page.locator('#episodeNumber')).toHaveValue('2');
  await expect(page.locator('#title')).toHaveValue('編集前の第2話');
  await expect(page.locator('#content')).toHaveValue('編集前の本文です。');
  await expect(page.locator('#save')).toBeEnabled();

  await page.locator('#episodeNumber').fill('3');
  await page.locator('#title').fill('編集後の第3話');
  await page.locator('#content').fill('編集後の本文です。');
  await page.locator('#save').click();

  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#status')).toHaveText('保存しています...');

  const evidence = await page.evaluate(() => {
    const calls = globalThis.__NOVELIGHT_EDIT_E2E_CALLS__;
    return {
      update: calls.find(
        (call) => call.type === 'update' && call.table === 'episodes'
      ),
      filters: calls
        .filter(
          (call) =>
            call.type === 'eq' &&
            call.table === 'episodes' &&
            call.operation === 'update'
        )
        .map(({ column, value }) => [column, value])
    };
  });
  expect(evidence.update?.payload).toEqual({
    episode_number: 3,
    title: '編集後の第3話',
    content: '編集後の本文です。'
  });
  expect(evidence.filters).toEqual([
    ['id', 'episode-edit-e2e'],
    ['user_id', 'author-e2e']
  ]);

  await page.waitForURL(/\/episode\.html\?id=episode-edit-e2e$/);
  await expect(page.locator('#card h1')).toHaveText('編集後の第3話');
  await expect(page.locator('#card .number')).toHaveText('第3話');
  await expect(page.locator('#card .content')).toHaveText('編集後の本文です。');
  expect(pageErrors).toEqual([]);
});

test('episode edit recovers after an async save failure', async ({ page }) => {
  await installEditSupabaseStub(page, {
    session: { user: { id: 'author-e2e' } },
    updateDelayMs: 300,
    updateErrors: { episodes: 'temporary database error' },
    singleData: {
      episodes: {
        id: 'episode-edit-failure-e2e',
        novel_id: 'novel-for-failure-e2e',
        user_id: 'author-e2e',
        episode_number: 1,
        title: '保存失敗前の第1話',
        content: '保存失敗テストの本文です。'
      }
    }
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/episode-edit.html?id=episode-edit-failure-e2e');
  await expect(page.locator('#save')).toBeEnabled();
  await page.locator('#title').fill('保存に失敗する第1話');
  await page.locator('#save').click();

  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#status')).toHaveText('保存しています...');
  await expect(page.locator('#status')).toHaveText(
    '保存できませんでした。時間をおいて再度お試しください。'
  );
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page).toHaveURL(
    /\/episode-edit\.html\?id=episode-edit-failure-e2e$/
  );

  const calls = await page.evaluate(() => globalThis.__NOVELIGHT_EDIT_E2E_CALLS__);
  expect(updateEvidenceFor('episodes', calls).update).toBeTruthy();
  expect(pageErrors).toEqual([]);
});
