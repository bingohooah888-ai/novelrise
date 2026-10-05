import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const fixturePath = process.env.PRODUCTION_AUTH_SMOKE_FIXTURE;
const productionStorageKey = 'sb-fiepaguycecrredwrcwx-auth-token';
const productionUrl = 'https://fiepaguycecrredwrcwx.supabase.co';
const productionKey = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';

if (!fixturePath) throw new Error('PRODUCTION_AUTH_SMOKE_FIXTURE is required.');

function loadDesktopReader() {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const reader = fixture.projects?.desktop?.reader;
  if (!reader?.email || !reader?.password || !reader?.id) {
    throw new Error('Missing desktop reader smoke identity.');
  }
  return reader;
}

async function snapshotAuth(page) {
  return page.evaluate(
    async ({ storageKey, url, key }) => {
      const raw = globalThis.localStorage.getItem(storageKey);
      let persisted = null;
      try {
        persisted = raw ? JSON.parse(raw) : null;
      } catch {
        persisted = null;
      }

      const shape = {
        storagePresent: Boolean(raw),
        parseableObject: Boolean(persisted && typeof persisted === 'object'),
        topLevelAccessToken: Boolean(persisted?.access_token),
        nestedAccessToken: Boolean(persisted?.currentSession?.access_token),
        topLevelUserId: persisted?.user?.id ?? null,
        nestedUserId: persisted?.currentSession?.user?.id ?? null,
        hasSupabase: typeof globalThis.supabase?.createClient === 'function'
      };

      let getSession = {
        attempted: false,
        hasSession: false,
        userId: null,
        error: null
      };

      if (shape.hasSupabase) {
        getSession.attempted = true;
        try {
          const client = globalThis.supabase.createClient(url, key);
          const result = await client.auth.getSession();
          getSession = {
            attempted: true,
            hasSession: Boolean(result?.data?.session),
            userId: result?.data?.session?.user?.id ?? null,
            error: result?.error?.message ?? null
          };
        } catch (error) {
          getSession.error = String(error?.message || error);
        }
      }

      return {
        href: globalThis.location.href,
        pathname: globalThis.location.pathname,
        shape,
        getSession
      };
    },
    { storageKey: productionStorageKey, url: productionUrl, key: productionKey }
  );
}

test('SCOUT RECORD preserves authenticated reader session across navigation', async ({
  page
}) => {
  const reader = loadDesktopReader();

  await page.goto('/login.html?redirect=index.html');
  await page.locator('#email').fill(reader.email);
  await page.locator('#password').fill(reader.password);
  await page.locator('#loginButton').click();
  await page.waitForURL((url) => url.pathname.endsWith('/index.html'));

  const before = await snapshotAuth(page);
  console.log(`SCOUT_AUTH_DIAG before=${JSON.stringify(before)}`);
  expect(before.shape.storagePresent).toBe(true);
  expect(before.shape.topLevelUserId ?? before.shape.nestedUserId).toBe(
    reader.id
  );

  await page.goto('/scout-record.html');
  await page.waitForTimeout(6000);

  const after = await snapshotAuth(page);
  console.log(`SCOUT_AUTH_DIAG after=${JSON.stringify(after)}`);

  expect(after.pathname).toBe('/scout-record.html');
  expect(after.shape.storagePresent).toBe(true);
  expect(after.shape.topLevelUserId ?? after.shape.nestedUserId).toBe(
    reader.id
  );
  expect(after.getSession.error).toBeNull();
  expect(after.getSession.hasSession).toBe(true);
  await expect(
    page.getByRole('heading', { name: 'SCOUT RECORD', exact: true })
  ).toBeVisible();
});
