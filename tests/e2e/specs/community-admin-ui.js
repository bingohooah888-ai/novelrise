// Isolated browser-only moderation proof. Never calls hosted Supabase or live admin API.
// A successful local mock test is NOT hosted Staging acceptance.
import { expect, test } from '../fixtures/diagnostic-fixture.js';

const POST_KEY = 'note:42';
const USER_ID = 'b0b00000-0000-4000-8000-000000000001';
const INERT_REASON = '<img src=x onerror=alert(9)>';
const DATE = '2026-10-16T09:00:00Z';

async function installIsolatedAdmin(page, { forbidden = false } = {}) {
  const state = {
    requests: [],
    reports: [
      {
        id: 1,
        post_key: POST_KEY,
        reporter_user_id: USER_ID,
        reason: INERT_REASON,
        status: 'pending',
        created_at: DATE
      }
    ],
    hidden: [],
    restrictions: []
  };

  // Any accidental real Supabase connection must fail rather than reach Production.
  await page.route('**/*.supabase.co/**', (route) =>
    route.abort('blockedbyclient')
  );
  await page.route('**/assets/vendor/supabase-js-2.112.3.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: [
        'window.supabase={createClient:()=>({',
        'auth:{getSession:async()=>({data:{session:{access_token:"synthetic-admin-token"}},error:null}),',
        'getUser:async()=>({data:{user:{id:"b0b00000-0000-4000-8000-000000000002"}},error:null}),',
        'onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},',
        'rpc:async()=>({data:[],error:null})',
        '})};'
      ].join('')
    })
  );
  await page.route('**/api/admin-community', async (route) => {
    const request = route.request();
    state.requests.push({
      method: request.method(),
      auth: request.headers().authorization,
      body: request.method() === 'POST' ? request.postDataJSON() : null
    });
    if (forbidden) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: '{"error":"Forbidden"}'
      });
      return;
    }

    if (request.method() === 'POST') {
      const {
        action,
        post_key: postKey,
        user_id: userId,
        reason
      } = request.postDataJSON();
      if (action === 'hide') {
        state.reports = state.reports.filter((row) => row.post_key !== postKey);
        state.hidden = [{ post_key: postKey, reason, hidden_at: DATE }];
      } else if (action === 'restore') {
        state.hidden = state.hidden.filter((row) => row.post_key !== postKey);
      } else if (action === 'restrict') {
        state.restrictions = [
          {
            user_id: userId,
            reason,
            expires_at: '2026-10-23T09:00:00Z',
            created_at: DATE
          }
        ];
      } else if (action === 'unrestrict') {
        state.restrictions = state.restrictions.filter(
          (row) => row.user_id !== userId
        );
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, action, target: postKey || userId })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reports: state.reports,
        hidden: state.hidden,
        restrictions: state.restrictions,
        metrics: {
          journey_entries: 12,
          unique_visitors: 8,
          qualified_reads: 4,
          interactors: 3,
          repeat_interactors: 2
        }
      })
    });
  });
  return state;
}

test('unauthorized moderator response hides all private rows', async ({
  page
}) => {
  const state = await installIsolatedAdmin(page, { forbidden: true });
  await page.goto('/admin-community.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#communityAdminStatus')).toContainText(
    '管理者権限がありません'
  );
  await expect(page.locator('#communityAdminContent')).toBeHidden();
  await expect(page.locator('#communityReportRows tr')).toHaveCount(0);
  expect(state.requests.map((call) => call.method)).toEqual(['GET']);
});

test('isolated moderator UI hide, restore, restrict and unrestrict', async ({
  page
}) => {
  const state = await installIsolatedAdmin(page);
  let injectedAlertCount = 0;
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'alert') {
      injectedAlertCount += 1;
      void dialog.dismiss();
      return;
    }
    void dialog.accept();
  });

  await page.goto('/admin-community.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#communityAdminContent')).toBeVisible();
  await expect(page.locator('#communityMetrics')).toContainText(
    '交流経由の認定有効読書：4'
  );
  await expect(page.locator('#communityReportRows')).toContainText(
    INERT_REASON
  );
  await expect(page.locator('#communityReportRows img')).toHaveCount(0);
  expect(injectedAlertCount).toBe(0);

  const reportRows = page.locator('#communityReportRows');
  await reportRows.getByRole('button', { name: '非表示' }).click();
  await expect(page.locator('#communityHiddenRows li')).toHaveCount(1);
  const hiddenRows = page.locator('#communityHiddenRows');
  await hiddenRows.getByRole('button', { name: '復元' }).click();
  await expect(page.locator('#communityHiddenRows li')).toHaveCount(0);

  const form = page.locator('#communityRestrictForm');
  await form.locator('input[name="userId"]').fill(USER_ID);
  await form
    .locator('textarea[name="reason"]')
    .fill('通報内容を確認して7日間制限');
  await page.locator('#communityRestrictForm button[type="submit"]').click();
  await expect(page.locator('#communityRestrictedRows li')).toHaveCount(1);
  const restrictedRows = page.locator('#communityRestrictedRows');
  await restrictedRows.getByRole('button', { name: '解除' }).click();
  await expect(page.locator('#communityRestrictedRows li')).toHaveCount(0);

  const writes = state.requests.filter((call) => call.method === 'POST');
  expect(writes.map((call) => call.body.action)).toEqual([
    'hide',
    'restore',
    'restrict',
    'unrestrict'
  ]);
  expect(writes[0].body.post_key).toBe(POST_KEY);
  expect(writes[2].body.user_id).toBe(USER_ID);
  const allAuthenticated = state.requests.every(
    (call) => call.auth === 'Bearer synthetic-admin-token'
  );
  expect(allAuthenticated).toBe(true);
  expect(injectedAlertCount).toBe(0);

  const sizes = await page.evaluate(() => ({
    content: globalThis.document.documentElement.scrollWidth,
    viewport: globalThis.document.documentElement.clientWidth
  }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport + 1);
});
