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

async function snapshotDom(page) {
  return page.evaluate(() => {
    const headings = Array.from(globalThis.document.querySelectorAll('h1'));
    const target = headings.find(
      (heading) => heading.textContent?.trim() === 'SCOUT RECORD'
    );
    const style = target ? globalThis.getComputedStyle(target) : null;
    const rect = target?.getBoundingClientRect();
    const ancestry = [];
    let current = target?.parentElement || null;
    while (current) {
      ancestry.push({
        tag: current.tagName,
        id: current.id || null,
        className: current.className || null,
        hidden: current.hidden,
        ariaHidden: current.getAttribute('aria-hidden'),
        inert: current.hasAttribute('inert'),
        display: globalThis.getComputedStyle(current).display,
        visibility: globalThis.getComputedStyle(current).visibility
      });
      current = current.parentElement;
    }

    return {
      h1Count: headings.length,
      h1Texts: headings.map((heading) => heading.textContent?.trim() || ''),
      targetExists: Boolean(target),
      targetHidden: target?.hidden ?? null,
      targetAriaHidden: target?.getAttribute('aria-hidden') ?? null,
      display: style?.display ?? null,
      visibility: style?.visibility ?? null,
      opacity: style?.opacity ?? null,
      rect: rect
        ? {
            width: rect.width,
            height: rect.height,
            top: rect.top,
            left: rect.left
          }
        : null,
      mainExists: Boolean(globalThis.document.querySelector('#main-content')),
      bodyClass: globalThis.document.body.className,
      openDialogs: Array.from(
        globalThis.document.querySelectorAll('dialog[open]')
      ).map(
        (dialog) => dialog.id || dialog.getAttribute('aria-label') || 'dialog'
      ),
      ancestry
    };
  });
}

test('SCOUT RECORD preserves authenticated reader session across navigation', async ({
  page
}) => {
  const reader = loadDesktopReader();

  await page.goto('/login.html?redirect=mypage.html');
  await page.locator('#email').fill(reader.email);
  await page.locator('#password').fill(reader.password);
  await page.locator('#loginButton').click();
  await page.waitForURL((url) => url.pathname.endsWith('/mypage.html'));

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
  const dom = await snapshotDom(page);
  console.log(`SCOUT_DOM_DIAG ${JSON.stringify(dom)}`);

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
