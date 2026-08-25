import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const fixturePath = process.env.PRODUCTION_AUTH_SMOKE_FIXTURE;
const e2eSupabaseUrl = process.env.E2E_SUPABASE_URL;
const e2eSupabasePublishableKey = process.env.E2E_SUPABASE_PUBLISHABLE_KEY;
const completeBilling = process.env.E2E_COMPLETE_BILLING === 'true';
const checkoutSessionPrefix = process.env.CHECKOUT_SESSION_PREFIX || '';
const productionSupabaseHost = 'fiepaguycecrredwrcwx.supabase.co';

if (!fixturePath) throw new Error('PRODUCTION_AUTH_SMOKE_FIXTURE is required.');

test.skip(
  !completeBilling,
  'Complete billing smoke is opt-in and only runs in isolated Stripe test mode.'
);

function loadFixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

function resolveStagingSupabaseOverride() {
  if (!e2eSupabaseUrl || !e2eSupabasePublishableKey) {
    throw new Error(
      'Billing smoke requires E2E_SUPABASE_URL and E2E_SUPABASE_PUBLISHABLE_KEY.'
    );
  }

  const target = new globalThis.URL(e2eSupabaseUrl);
  if (
    target.protocol !== 'https:' ||
    !target.hostname.endsWith('.supabase.co') ||
    target.hostname === productionSupabaseHost
  ) {
    throw new Error('Billing smoke refuses the production Supabase project.');
  }

  return {
    url: target.origin,
    key: e2eSupabasePublishableKey,
    projectRef: target.hostname.split('.')[0]
  };
}

const stagingSupabase = resolveStagingSupabaseOverride();

async function installStagingSupabaseOverride(context) {
  await context.addInitScript(({ url, key }) => {
    let assignedSupabase;
    Object.defineProperty(globalThis, 'supabase', {
      configurable: true,
      get() {
        return assignedSupabase;
      },
      set(value) {
        assignedSupabase = value;
        if (!value || typeof value.createClient !== 'function') return;

        const originalCreateClient = value.createClient.bind(value);
        value.createClient = (_url, _key, options) =>
          originalCreateClient(url, key, options);
      }
    });
  }, stagingSupabase);
}

async function login(page, account) {
  await page.goto('/login.html?redirect=pricing.html');
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.locator('#loginButton').click();
  await page.waitForURL(/\/pricing\.html/);

  const authKeys = await page.evaluate(() => {
    const keys = [];
    for (let index = 0; index < globalThis.localStorage.length; index += 1) {
      const key = globalThis.localStorage.key(index);
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) keys.push(key);
    }
    return keys;
  });

  expect(authKeys).toContain(`sb-${stagingSupabase.projectRef}-auth-token`);
  expect(authKeys).not.toContain('sb-fiepaguycecrredwrcwx-auth-token');
}

async function getAccessToken(page) {
  const accessToken = await page.evaluate(() => {
    for (let index = 0; index < globalThis.localStorage.length; index += 1) {
      const key = globalThis.localStorage.key(index);
      if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
      const raw = globalThis.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const stored = JSON.parse(raw);
        const token =
          stored?.access_token ?? stored?.currentSession?.access_token;
        if (token) return token;
      } catch {
        // Ignore unrelated local-storage entries.
      }
    }
    return null;
  });

  expect(accessToken).toBeTruthy();
  return accessToken;
}

async function getBillingState(page) {
  await page.waitForFunction(
    () => typeof globalThis.supabase?.createClient === 'function'
  );

  return page.evaluate(async ({ url, key }) => {
    const client = globalThis.supabase.createClient(url, key);
    const auth = await client.auth.getSession();
    if (!auth.data.session) throw new Error('Billing session is unavailable.');

    const result = await client
      .from('profiles')
      .select(
        'plan,payment_status,stripe_customer_id,stripe_subscription_id,subscription_status,subscription_cancel_at_period_end'
      )
      .eq('id', auth.data.session.user.id)
      .single();

    if (result.error) throw new Error(result.error.message);
    return result.data;
  }, stagingSupabase);
}

function checkoutSessionIdFromUrl(checkoutUrl) {
  const match = checkoutUrl.match(/cs_test_[A-Za-z0-9_]+/);
  expect(match?.[0]).toBeTruthy();
  return match[0];
}

async function reconcileStagingBilling(page, accessToken, checkoutSessionId) {
  const response = await page.request.post('/api/staging-billing-reconcile', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    data: checkoutSessionId ? { checkoutSessionId } : {}
  });

  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.synced).toBe(true);
}

async function firstVisibleAcrossFrames(page, selectors, timeout = 20_000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const locator = frame.locator(selector).first();
        if (
          (await locator.count()) > 0 &&
          (await locator.isVisible().catch(() => false))
        ) {
          return locator;
        }
      }
    }
    await page.waitForTimeout(250);
  }

  throw new Error(`No visible Stripe field matched: ${selectors.join(', ')}`);
}

async function fillOptionalAcrossFrames(page, selectors, value) {
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const locator = frame.locator(selector).first();
      if (
        (await locator.count()) > 0 &&
        (await locator.isVisible().catch(() => false))
      ) {
        await locator.fill(value);
        return true;
      }
    }
  }
  return false;
}

async function disableStripeLinkOptIn(page) {
  for (const frame of page.frames()) {
    const checkbox = frame
      .getByRole('checkbox', { name: /save my information/i })
      .first();
    if (
      (await checkbox.count()) > 0 &&
      (await checkbox.isVisible().catch(() => false))
    ) {
      if (await checkbox.isChecked()) await checkbox.uncheck();
      return true;
    }
  }
  return false;
}

async function completeStripeCheckout(page, checkoutUrl, appOrigin) {
  const checkout = new globalThis.URL(checkoutUrl);
  expect(checkout.hostname).toBe('checkout.stripe.com');
  expect(checkout.pathname).toContain(checkoutSessionPrefix);
  expect(checkoutSessionPrefix).toBe('cs_test_');

  await page.goto(checkoutUrl);

  const cardNumber = await firstVisibleAcrossFrames(page, [
    'input[name="cardNumber"]',
    'input[autocomplete="cc-number"]'
  ]);
  const expiry = await firstVisibleAcrossFrames(page, [
    'input[name="cardExpiry"]',
    'input[autocomplete="cc-exp"]'
  ]);
  const cvc = await firstVisibleAcrossFrames(page, [
    'input[name="cardCvc"]',
    'input[autocomplete="cc-csc"]'
  ]);

  await cardNumber.fill('4242424242424242');
  await expiry.fill('1234');
  await cvc.fill('123');

  await fillOptionalAcrossFrames(
    page,
    ['input[name="billingName"]', 'input[autocomplete="cc-name"]'],
    'NOVELIGHT Staging Billing Smoke'
  );
  await fillOptionalAcrossFrames(
    page,
    ['input[name="billingPostalCode"]', 'input[autocomplete="postal-code"]'],
    '10001'
  );
  await disableStripeLinkOptIn(page);

  const submit = await firstVisibleAcrossFrames(page, [
    'button[type="submit"]'
  ]);
  await submit.click();

  const appHost = new globalThis.URL(appOrigin).hostname;
  await page.waitForURL(
    (url) => url.hostname === appHost && url.pathname.endsWith('/mypage.html'),
    { timeout: 60_000 }
  );
}

async function openBillingPortal(page, accessToken) {
  const response = await page.request.post(
    '/api/create-billing-portal-session',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.url).toBeTruthy();
  expect(new globalThis.URL(body.url).hostname).toBe('billing.stripe.com');
  await page.goto(body.url);
}

async function cancelThroughPortal(page) {
  const cancellationEntry = await firstVisibleAcrossFrames(
    page,
    [
      'button:has-text("Cancel plan")',
      'a:has-text("Cancel plan")',
      'button:has-text("Cancel subscription")',
      'a:has-text("Cancel subscription")',
      'button:has-text("プランをキャンセル")',
      'a:has-text("プランをキャンセル")',
      'button:has-text("解約")',
      'a:has-text("解約")'
    ],
    30_000
  );
  await cancellationEntry.click();

  const openCancelDialog = await firstVisibleAcrossFrames(
    page,
    [
      '[data-testid="confirm"]',
      'button:has-text("Cancel subscription")',
      'button:has-text("Cancel plan")'
    ],
    20_000
  );
  await openCancelDialog.press('Enter');

  const continueCancellation = await firstVisibleAcrossFrames(
    page,
    [
      '[role="alertdialog"] [role="button"]:has-text("Continue to cancellation")',
      '[role="alertdialog"] a:has-text("Continue to cancellation")',
      '[role="alertdialog"] [role="button"]:has-text("解約")'
    ],
    20_000
  );
  await continueCancellation.press('Enter');
  await expect(continueCancellation).toBeHidden({ timeout: 30_000 });

  const finalCancellation = await firstVisibleAcrossFrames(
    page,
    [
      '[data-testid="confirm"]',
      'button:has-text("Cancel subscription")',
      'button:has-text("Cancel plan")',
      'button:has-text("プランをキャンセル")',
      'button:has-text("解約する")'
    ],
    20_000
  );
  await finalCancellation.press('Enter');
  await expect(finalCancellation).toBeHidden({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
}

test('Stripe test checkout, entitlement, portal, and cancellation work in staging', async ({
  browser,
  baseURL
}) => {
  test.setTimeout(210_000);
  const fixture = loadFixture();
  const context = await browser.newContext({ baseURL, locale: 'en-US' });
  await installStagingSupabaseOverride(context);
  const page = await context.newPage();

  try {
    await login(page, fixture.author);

    const accessToken = await getAccessToken(page);
    const checkoutResponse = await page.request.post(
      '/api/create-checkout-session',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        data: { plan: 'standard' }
      }
    );
    expect(checkoutResponse.status()).toBe(200);
    const checkoutBody = await checkoutResponse.json();
    expect(checkoutBody.mode).toBe('checkout');
    const checkoutSessionId = checkoutSessionIdFromUrl(checkoutBody.url);

    await completeStripeCheckout(page, checkoutBody.url, baseURL);
    await reconcileStagingBilling(page, accessToken, checkoutSessionId);

    await expect
      .poll(
        async () => {
          await page.goto('/mypage.html?checkout=success');
          await expect(page.locator('#plan')).not.toHaveText('確認中');
          return (await getBillingState(page)).plan;
        },
        { timeout: 45_000, intervals: [1000, 2000, 3000] }
      )
      .toBe('standard');

    const paidState = await getBillingState(page);
    expect(paidState.stripe_customer_id).toMatch(/^cus_/);
    expect(paidState.stripe_subscription_id).toMatch(/^sub_/);
    expect(['active', 'trialing', 'past_due']).toContain(
      paidState.subscription_status
    );

    await openBillingPortal(page, accessToken);
    await cancelThroughPortal(page);

    await page.goto('/mypage.html');
    await expect
      .poll(
        async () => {
          await reconcileStagingBilling(page, accessToken);
          const state = await getBillingState(page);
          return (
            state.plan === 'free' ||
            state.subscription_status === 'canceled' ||
            state.subscription_cancel_at_period_end === true
          );
        },
        { timeout: 45_000, intervals: [1000, 2000, 3000] }
      )
      .toBeTruthy();
  } finally {
    await context.close();
  }
});
