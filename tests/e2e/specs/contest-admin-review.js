import { expect, test } from '../fixtures/diagnostic-fixture.js';

const READER = 'caf00000-0000-4000-8000-000000000092';
const CONTEST = 'caf00000-0000-4000-8000-000000000090';

async function mockAdminReview(page, options = {}) {
  const state = {
    status: 'provisional',
    posts: [],
    maliciousNote: '<img src=x onerror=alert(9)>',
    ...options
  };
  await page.route('**/assets/vendor/supabase-js-2.112.3.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: "window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'test-admin-session'}},error:null})}})};"
    })
  );
  await page.route('**/api/admin-contest-review**', async (route) => {
    const req = route.request();
    if (state.forbidden) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Forbidden' })
      });
      return;
    }
    let status = 200;
    let payload;
    const url = new URL(req.url());
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      state.posts.push(body);
      if (state.stale) {
        state.status = 'review_hold';
        status = 409;
        payload = { ok: false, error: 'stale_review' };
      } else {
        state.status = body.action === 'hold' ? 'review_hold'
          : body.action === 'reopen' ? 'provisional' : 'cleared';
        payload = {
          ok: true,
          prize_finalized: false,
          result: { review_status: state.status }
        };
      }
    } else if (url.searchParams.has('reader_id')) {
      payload = {
        ok: true,
        contest_status: 'draft',
        reader: { id: READER, kind: 'account', review_status: state.status },
        risk: {
          signal_codes: ['overlapping_episode_sessions'],
          metrics: { overlapping_session_pairs_last_day: 2 }
        },
        scores: [{
          entry_id: CONTEST,
          points: 3,
          qualified_episode_count: 5,
          review_status: state.status
        }],
        audit: [{
          created_at: '2026-10-13T10:00:00Z',
          action: 'operator_review_hold',
          actor_user_id: CONTEST,
          reason_code: 'anomalous_reading',
          evidence_summary: { operator_note: state.maliciousNote }
        }]
      };
    } else {
      payload = {
        ok: true,
        readers: [{
          id: READER,
          kind: 'account',
          user_id: CONTEST,
          review_status: state.status,
          updated_at: '2026-10-13T10:00:00Z',
          risk_codes: ['overlapping_episode_sessions'],
          requires_manual_review: true
        }],
        contest_status: 'draft',
        public_visible: false,
        total: 1,
        page: 1,
        limit: 20,
        provisional_only: true
      };
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload)
    });
  });
  return state;
}

test('operator evidence is inert text and the contest remains private', async ({
  page
}) => {
  const state = await mockAdminReview(page);
  let dialogOpened = false;
  page.on('dialog', (dialog) => {
    dialogOpened = true;
    void dialog.dismiss();
  });
  await page.goto('/admin-contest-review.html');
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#contestState')).toContainText('非公開');
  await expect(page.locator('#readers tr')).toHaveCount(1);
  await page.getByRole('button', { name: '証跡を表示' }).click();
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#audit')).toContainText(state.maliciousNote);
  await expect(page.locator('#audit img')).toHaveCount(0);
  expect(dialogOpened).toBe(false);
});

test('operator hold requires evidence and submits expected version', async ({
  page
}) => {
  const state = await mockAdminReview(page);
  await page.goto('/admin-contest-review.html');
  await page.getByRole('button', { name: '証跡を表示' }).click();
  await expect(page.locator('#detail')).toBeVisible();
  await page.locator('#note').fill('short');
  await page.locator('#submit').click();
  await expect(page.locator('#status')).toContainText('20～500文字');
  expect(state.posts).toHaveLength(0);

  const note = 'Two anomalous reading sessions need manual inspection before acceptance';
  await page.locator('#note').fill(note);
  await page.locator('#submit').click();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0]).toMatchObject({
    action: 'hold',
    reader_id: READER,
    expected_status: 'provisional',
    reason_code: 'anomalous_reading',
    note
  });
  await expect(page.locator('#readerInfo')).toContainText('review_hold');
  await expect(page.locator('#readers')).toContainText('review_hold');
});

test('stale review conflict preserves entered evidence for operator', async ({
  page
}) => {
  const state = await mockAdminReview(page, { stale: true });
  await page.goto('/admin-contest-review.html');
  await page.getByRole('button', { name: '証跡を表示' }).click();
  await expect(page.locator('#readerInfo')).toContainText('provisional');
  const note = 'The same two reader sessions require further manual investigation';
  await page.locator('#note').fill(note);
  await page.locator('#submit').click();
  await expect.poll(() => state.posts.length).toBe(1);
  await expect(page.locator('#status')).toContainText('stale_review');
  await expect(page.locator('#readerInfo')).toContainText('review_hold');
  await expect(page.locator('#note')).toHaveValue(note);
});

test('forbidden operator API discloses no private reader data', async ({
  page
}) => {
  await mockAdminReview(page, { forbidden: true });
  await page.goto('/admin-contest-review.html');
  await expect(page.locator('#status')).toContainText('Forbidden');
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#readers tr')).toHaveCount(0);
});
