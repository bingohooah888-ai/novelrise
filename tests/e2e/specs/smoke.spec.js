import { expect, test } from '../fixtures/diagnostic-fixture.js';
// Local mock only; runs on CI desktop/mobile Chromium without Staging traffic.
import './community-plaza-ui.js';
import './community-plaza-board.js';

const publicPages = [
  ['home', '/index.html'],
  ['search', '/search.html'],
  ['ranking', '/ranking.html'],
  ['pricing', '/pricing.html'],
  ['login', '/login.html'],
  ['signup', '/signup.html'],
  ['forgot password', '/forgot-password.html'],
  ['reset password', '/reset-password.html'],
  ['novel detail', '/novel.html'],
  ['episode', '/episode.html'],
  ['author', '/author.html'],
  ['terms', '/terms.html'],
  ['privacy', '/privacy.html'],
  ['content guidelines', '/content-guidelines.html'],
  ['billing policy', '/billing-policy.html'],
  ['commerce disclosure', '/commerce-disclosure.html'],
  ['contact', '/contact.html'],
  ['bulk import', '/bulk-import.html']
];

for (const [name, path] of publicPages) {
  test(`${name} page renders`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    expect(html).toContain('<meta name="viewport"');
    expect(html).toMatch(/<title>[^<]+<\/title>/);
  });
}

test('auth pages expose verified-mail recovery flows', async ({ request }) => {
  const login = await (await request.get('/login.html')).text();
  const forgot = await (await request.get('/forgot-password.html')).text();
  const reset = await (await request.get('/reset-password.html')).text();

  expect(login).toContain('href="forgot-password.html"');
  expect(login).toContain('safeRedirectTarget');
  expect(forgot).toContain('resetPasswordForEmail');
  expect(forgot).toContain('登録済みのメールアドレスであれば');
  expect(reset).toContain('updateUser({password})');
  expect(reset).toContain("signOut({scope:'global'})");
});

test('posting shell requires classification and policy acknowledgement', async ({
  request
}) => {
  const post = await (await request.get('/post.html')).text();
  expect(post).toContain('id="aiUsage"');
  expect(post).toContain('id="contentRating"');
  expect(post).toContain('id="warningGrid"');
  expect(post).toContain('id="policyAck"');
});

test('reader pages expose zoning, report, and beta measurement hooks', async ({
  request
}) => {
  const novel = await (await request.get('/novel.html')).text();
  const episode = await (await request.get('/episode.html')).text();

  expect(novel).toContain('id="warningGate"');
  expect(novel).toContain('submit_content_report');
  expect(novel).toContain("'detail_open'");
  expect(novel).toContain("'favorite_added'");
  expect(novel).toContain("'light_seed'");

  expect(episode).toContain('id="warning"');
  expect(episode).toContain('submit_content_report');
  expect(episode).toContain("'episode_read_10s'");
  expect(episode).toContain("'visibilitychange'");
});

test('LIGHT ANALYTICS exposes the beta funnel and plan-only exposure', async ({
  request
}) => {
  const html = await (await request.get('/analytics.html')).text();
  const analytics = await (await request.get('/novelight-analytics.js')).text();

  expect(html).toContain('<title>LIGHT ANALYTICS | NOVELIGHT</title>');
  expect(html).toContain('露出後お気に入り');
  expect(html).toContain('src="novelight-analytics.js"');
  expect(analytics).toContain('作品ページ→第1話');
  expect(analytics).toContain('第1話→第2話');
  expect(analytics).toContain('plan_extra_impressions');
  expect(analytics).toContain('novelight_author_exposure_funnel_v2');
  expect(html).not.toContain('LIGHT REPORT');
  expect(analytics).not.toContain('LIGHT REPORT');
});

test('home and search use trusted discovery and complete impression tracking', async ({
  request
}) => {
  const home = await (await request.get('/index.html')).text();
  const search = await (await request.get('/search.html')).text();

  expect(home).toContain('novelight_trusted_discovery_feed');
  expect(home).toContain('novelight_trusted_plan_extra_feed');
  expect(home).toContain('record_trusted_allocation_receipts');
  expect(search).toContain('recordNeutralSearchImpressions');
  expect(search).toContain('record_trusted_allocation_receipts');
});

test('pricing desktop refinement keeps the approved CSS contract', async ({
  request
}) => {
  const css = await (await request.get('/novelight-plan-badges.css')).text();
  expect(css).toContain('@media (min-width: 901px)');
  expect(css).toContain('grid-template-columns: auto minmax(520px, 1fr) auto;');
  expect(css).toContain('font-size: 17px;');
  expect(css).toContain('font-size: 15px;');
  expect(css).toContain('width: 189px;');
  expect(css).toContain('min-height: 748px;');
  expect(css).toContain('word-break: auto-phrase;');
  expect(css).toContain('padding: 8px 0 8px 1.45em;');
});

test('all audited major routes fit a 390px mobile viewport', async ({
  browser
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    javaScriptEnabled: false
  });
  const page = await context.newPage();
  const routes = [
    '/index.html',
    '/signup.html',
    '/login.html',
    '/search.html',
    '/novel.html',
    '/episode.html',
    '/post.html',
    '/bulk-import.html',
    '/episode-post.html',
    '/favorites.html',
    '/scout-record.html',
    '/analytics.html',
    '/mypage.html',
    '/pricing.html'
  ];

  for (const path of routes) {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), `${path} should load`).toBeTruthy();
    const overflow = await page.locator('html').evaluate((html) => ({
      scrollWidth: html.scrollWidth,
      clientWidth: html.clientWidth
    }));
    expect(
      overflow.scrollWidth,
      `${path} horizontally overflows: ${JSON.stringify(overflow)}`
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);
  }

  await context.close();
});

test('bulk import exposes the beta author migration contract', async ({
  request
}) => {
  const html = await (await request.get('/bulk-import.html')).text();
  const parser = await (await request.get('/bulk-import-parser.js')).text();

  expect(html).toContain('最大100話');
  expect(html).toContain('novelight_bulk_import_episode_drafts');
  expect(html).toContain('novelight_record_bulk_import_event');
  expect(html).toContain('TextDecoder');
  expect(html).toContain('post.html?next=bulk-import');
  expect(parser).toContain('parseBulkEpisodes');
  expect(parser).toContain('maxFileBytes: 5 * 1024 * 1024');
});

async function capturePublicHeader(page) {
  return page.evaluate(() => {
    const round = (value) => Math.round(value * 1000) / 1000;
    const read = (selector) => {
      const element = globalThis.document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = globalThis.getComputedStyle(element);
      return {
        rect: {
          x: round(rect.x),
          y: round(rect.y),
          width: round(rect.width),
          height: round(rect.height)
        },
        display: style.display,
        visibility: style.visibility,
        position: style.position,
        fontSize: style.fontSize,
        gap: style.gap,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        backgroundColor: style.backgroundColor,
        borderBottomWidth: style.borderBottomWidth,
        borderBottomStyle: style.borderBottomStyle,
        borderBottomColor: style.borderBottomColor,
        boxShadow: style.boxShadow
      };
    };
    const betaLinks = globalThis.document.querySelectorAll(
      'header.site-header a[href="beta-authors.html"]'
    );

    return {
      viewport: {
        innerWidth: globalThis.innerWidth,
        clientWidth: globalThis.document.documentElement.clientWidth
      },
      siteHeader: read('header.site-header'),
      inner: read('header.site-header .public-header-inner'),
      logo: read('header.site-header .logo img'),
      desktopNav: read('header.site-header .desktop-nav'),
      firstNavLink: read('header.site-header .desktop-nav a'),
      actions: read('header.site-header .header-actions'),
      search: read('header.site-header .header-search'),
      login: read('header.site-header .login-action'),
      signup: read('header.site-header .signup-action'),
      mobileMenu: read('header.site-header .mobile-menu'),
      mobileSummary: read('header.site-header .mobile-menu summary'),
      betaLinkDisplays: Array.from(betaLinks).map(
        (element) => globalThis.getComputedStyle(element).display
      )
    };
  });
}

test('all public zones use the same responsive Home header scale', async ({
  browser
}) => {
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 }
  ];

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height }
    });
    const page = await context.newPage();

    const homeResponse = await page.goto('/index.html', {
      waitUntil: 'domcontentloaded'
    });
    expect(
      homeResponse?.ok(),
      `${viewport.name}: Home should load`
    ).toBeTruthy();
    const baseline = await capturePublicHeader(page);
    expect(
      baseline.betaLinkDisplays,
      `${viewport.name}: legacy beta-author header links must not remain on Home`
    ).toEqual([]);

    if (viewport.name === 'desktop') {
      expect(
        baseline.logo?.rect.height,
        'desktop: public header logo must use the shared 104.4px scale'
      ).toBeCloseTo(104.4, 1);
    }

    const specialResponse = await page.goto('/special-light.html', {
      waitUntil: 'domcontentloaded'
    });
    expect(
      specialResponse?.ok(),
      `${viewport.name}: SPECIAL LIGHT should load`
    ).toBeTruthy();
    expect(
      await capturePublicHeader(page),
      `${viewport.name}: special-light.html header must match Home exactly`
    ).toEqual(baseline);

    for (const zone of ['ai', 'r18']) {
      const zoneResponse = await page.goto(`/special-zone.html?zone=${zone}`, {
        waitUntil: 'domcontentloaded'
      });
      expect(
        zoneResponse?.ok(),
        `${viewport.name}: ${zone} zone should load`
      ).toBeTruthy();
      const zoneHeader = await capturePublicHeader(page);
      expect(
        zoneHeader.betaLinkDisplays,
        `${viewport.name}: ${zone} zone must not restore legacy beta-author links`
      ).toEqual([]);

      expect(
        zoneHeader,
        `${viewport.name}: ${zone} SPECIAL zone header should match Home`
      ).toEqual(baseline);
    }

    await page.goto('/special-zone.html?zone=r15', { waitUntil: 'load' });
    await expect(page).toHaveURL(/\/search\.html$/u);

    await context.close();
  }
});

for (const surface of ['post', 'edit']) {
  test(`episode-${surface} caret scroll`, async ({ page, request }) => {
    const response = await request.get(`/episode-${surface}.html`);
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    const css = html.match(/<style>([\s\S]*?)<\/style>/u)?.[1];
    expect(css).toBeTruthy();

    await page.setContent(`
      <!doctype html>
      <html lang="ja">
      <head>
        <meta name="viewport" content="width=device-width,initial-scale=1.0">
        <style>${css}</style>
      </head>
      <body class="novelight-theme novelight-page-episode-${surface}">
        <main>
          <form>
            <div class="editor-toolbar" id="toolbar">
              <span>保存済み</span>
              <div class="editor-tools"><button type="button">装飾</button></div>
            </div>
            <section class="writing-surface">
              <div class="body-field"><textarea id="content"></textarea></div>
            </section>
          </form>
          <div style="height:1200px"></div>
        </main>
      </body>
      </html>
    `);

    await page.evaluate(() => globalThis.scrollTo(0, 310));
    const toolbar = page.locator('#toolbar');
    const top = await toolbar.evaluate((element) => {
      return element.getBoundingClientRect().top;
    });
    expect(top).toBeLessThan(0);

    const field = page.locator('#content');
    const paragraphs = Array(120).fill('本文テスト。').join('\n');
    await field.fill(paragraphs);
    await field.press('ControlOrMeta+End');

    const before = await field.evaluate((element) => ({
      value: element.value,
      height: element.getBoundingClientRect().height,
      scrollTop: element.scrollTop,
      pageY: globalThis.scrollY,
      caret: element.selectionStart
    }));
    expect(before.scrollTop).toBeGreaterThan(0);

    await field.press('Enter');
    await field.press('Backspace');

    const after = await field.evaluate((element) => ({
      value: element.value,
      height: element.getBoundingClientRect().height,
      scrollTop: element.scrollTop,
      pageY: globalThis.scrollY,
      caret: element.selectionStart
    }));
    expect(after.value).toBe(before.value);
    expect(after.height).toBe(before.height);
    expect(after.caret).toBe(before.caret);
    expect(after.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(after.pageY - before.pageY)).toBeLessThan(3);
  });
}

test('public header stays in place through delayed client script', async ({
  page
}) => {
  const paths = [
    '/',
    '/recommended.html',
    '/light-seed.html',
    '/search.html',
    '/ranking.html',
    '/login.html',
    '/author.html',
    '/novel.html',
    '/pricing.html',
    '/announcements.html',
    '/news-detail.html',
    '/special-light.html'
  ];
  for (const path of paths) {
    let resume;
    await page.route('**/novelight-client.js', async (route) => {
      await new Promise((resolve) => {
        resume = resolve;
      });
      await route.continue();
    });
    await page.goto(path, { waitUntil: 'commit' });
    try {
      const header = page.locator('header.site-header .public-header-inner');
      await expect(header).toBeVisible();
      await page.waitForFunction(() => {
        const header = globalThis.document.querySelector('header.site-header');
        const skip = globalThis.document.querySelector('.skip-link');
        return (
          header &&
          globalThis.getComputedStyle(header).position === 'sticky' &&
          (!skip || globalThis.getComputedStyle(skip).position === 'fixed')
        );
      });
      await expect.poll(() => Boolean(resume)).toBe(true);
      const before = await page.evaluate(() => {
        const inner = globalThis.document.querySelector('.public-header-inner');
        const logo = inner.querySelector('.logo img');
        const box = inner.getBoundingClientRect();
        const logoBox = logo.getBoundingClientRect();
        return [
          box.x,
          box.y,
          box.width,
          box.height,
          logoBox.x,
          logoBox.y,
          logoBox.width,
          logoBox.height
        ];
      });
      resume();
      await page.waitForLoadState('load');
      const after = await page.evaluate(() => {
        const inner = globalThis.document.querySelector('.public-header-inner');
        const logo = inner.querySelector('.logo img');
        const box = inner.getBoundingClientRect();
        const logoBox = logo.getBoundingClientRect();
        return [
          box.x,
          box.y,
          box.width,
          box.height,
          logoBox.x,
          logoBox.y,
          logoBox.width,
          logoBox.height
        ];
      });
      const viewport = await page.evaluate(() => ({
        innerWidth: globalThis.innerWidth,
        clientWidth: globalThis.document.documentElement.clientWidth,
        documentWidth: globalThis.document.documentElement.scrollWidth
      }));
      for (let i = 0; i < before.length; i += 1) {
        expect(
          Math.abs(after[i] - before[i]),
          `${path} metric ${i} before=${before[i]} after=${after[i]} viewport=${JSON.stringify(viewport)}`
        ).toBeLessThanOrEqual(1);
      }
    } finally {
      resume?.();
      await page.unroute('**/novelight-client.js');
    }
  }
});

test('authenticated header label preserves its initial geometry', async ({
  page
}) => {
  await page.goto('/');
  const before = await page.locator('.public-header-inner').boundingBox();
  await page.evaluate(async () => {
    await globalThis.NovelightClient.syncAuthHeader({
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: 'test-only' } } },
          error: null
        })
      }
    });
  });
  await expect(page.locator('.login-action')).toHaveText('創作室');
  const labelOffset = await page.locator('.login-action').evaluate((el) => {
    const range = globalThis.document.createRange();
    range.selectNodeContents(el);
    const label = range.getBoundingClientRect();
    const button = el.getBoundingClientRect();
    const midpoint = (rect) => rect.left + rect.width / 2;
    return Math.abs(midpoint(label) - midpoint(button));
  });
  expect(labelOffset).toBeLessThanOrEqual(2);
  const after = await page.locator('.public-header-inner').boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  for (const key of ['x', 'y', 'width', 'height']) {
    expect(Math.abs(after[key] - before[key])).toBeLessThanOrEqual(1);
  }
});

test('admin shortcut preserves public menu coordinates', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  let baseline;
  for (const route of ['/', '/search.html', '/ranking.html']) {
    await page.goto(route);
    const navLinks = page.locator('.desktop-nav a');
    const measure = () =>
      navLinks.evaluateAll((links) =>
        links.map((link) => Math.round(link.getBoundingClientRect().x))
      );
    const before = await measure();
    if (baseline) {
      expect(before).toEqual(baseline);
    } else {
      baseline = before;
    }

    await page.evaluate(() => {
      const link = globalThis.document.createElement('a');
      link.className = 'novelight-admin-shortcut-desktop';
      const actions = globalThis.document.querySelector('.header-actions');
      actions.appendChild(link);
    });
    expect(await measure()).toEqual(before);
  }
});

test('public header actions stay fixed as reader and owner links appear', async ({
  page
}) => {
  for (const width of [1600, 1150, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const measure = () =>
      page.evaluate(() =>
        Array.from(
          globalThis.document.querySelectorAll(
            '.public-header-inner, .header-search, .login-action, .mobile-menu > summary, .desktop-nav a'
          )
        ).map((element) => {
          const box = element.getBoundingClientRect();
          return [box.x, box.y, box.width, box.height].map(Math.round);
        })
      );
    const baseline = await measure();
    await page.evaluate(() => {
      const header = globalThis.document.querySelector('.header-actions');
      const login = header.querySelector('.login-action');
      const signup = header.querySelector('.signup-action');
      const menu = header.querySelector('.mobile-menu');
      login.textContent = '創作室';
      login.dataset.authState = 'authenticated';
      signup.hidden = true;
      const reader = globalThis.document.createElement('div');
      reader.className = 'nl-reader-account-bar';
      reader.innerHTML =
        '<a class="nl-reader-nav-link">本棚</a>' +
        '<a class="nl-reader-account-chip"><span class="nl-reader-avatar">読</span></a>';
      header.insertBefore(reader, menu);
      const owner = globalThis.document.createElement('a');
      owner.className = 'novelight-admin-shortcut-desktop';
      owner.textContent = '管理画面';
      header.insertBefore(owner, menu);
    });
    expect(await measure(), `viewport ${width}`).toEqual(baseline);
  }
});

test('standard public pages match Home header geometry without hydration', async ({
  browser
}) => {
  const routes = [
    '/search.html',
    '/ranking.html',
    '/announcements.html',
    '/author-features.html',
    '/pricing.html',
    '/login.html',
    '/special-light.html'
  ];
  for (const width of [1600, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      javaScriptEnabled: false
    });
    const page = await context.newPage();
    const measure = () =>
      page.evaluate(() => {
        const selectors = [
          'header.site-header',
          'header.site-header .public-header-inner',
          'header.site-header .logo img',
          'header.site-header .desktop-nav a:nth-child(1)',
          'header.site-header .desktop-nav a:nth-child(2)',
          'header.site-header .desktop-nav a:nth-child(3)',
          'header.site-header .desktop-nav a:nth-child(4)',
          'header.site-header .header-actions',
          'header.site-header .header-search',
          'header.site-header .login-action',
          'header.site-header .mobile-menu summary'
        ];
        return selectors.flatMap((selector) => {
          const element = globalThis.document.querySelector(selector);
          const rect = element.getBoundingClientRect();
          return [rect.x, rect.y, rect.width, rect.height].map(Math.round);
        });
      });
    await page.goto('/index.html', { waitUntil: 'load' });
    const baseline = await measure();
    for (const route of routes) {
      await page.goto(route, { waitUntil: 'load' });
      const current = await measure();
      expect(current.length).toBe(baseline.length);
      for (let index = 0; index < baseline.length; index++) {
        const delta = Math.abs(current[index] - baseline[index]);
        expect.soft(delta, `${route} metric ${index}`).toBeLessThanOrEqual(1);
      }
    }
    await context.close();
  }
});

test('Home and public pages keep the approved off-white header', async ({
  page
}) => {
  const paths = [
    '/',
    '/pricing.html',
    '/special-light.html',
    '/search.html',
    '/ranking.html'
  ];
  for (const path of paths) {
    await page.goto(path);
    const header = page.locator('header.site-header');
    const logo = header.locator('.logo img');
    await expect(header).toHaveCSS(
      'background-color',
      'rgba(250, 249, 246, 0.98)'
    );
    await expect(logo).toHaveCSS('filter', 'none');
    await expect(logo).toHaveCSS('mix-blend-mode', 'normal');
    if (path === '/') {
      await page.evaluate(() => {
        const link = globalThis.document.createElement('a');
        link.className =
          'novelight-admin-shortcut novelight-admin-shortcut-desktop';
        link.textContent = '管理画面';
        const actions = globalThis.document.querySelector('.header-actions');
        actions.appendChild(link);
      });
      await expect(header.locator('.novelight-admin-shortcut')).toHaveCSS(
        'color',
        'rgb(14, 29, 53)'
      );
    }
  }
});

test('episode commenter avatar uses the same public RPC as author profile', async ({
  page
}) => {
  await page.goto('/tests/e2e/fixtures/comment-spoiler-display.html');
  await page.evaluate(async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const path = userId + '/22222222-2222-4222-8222-222222222222.webp';
    const client = {
      storage: {
        from: () => ({
          getPublicUrl: () => ({
            data: { publicUrl: '/assets/scout-badges/reader_read_005.png' }
          })
        })
      },
      rpc: async (name) => {
        if (name === 'novelight_public_author_avatar') {
          return { data: path, error: null };
        }
        if (name === 'novelight_novel_comment_reception_state') {
          return { data: { comments_enabled: true }, error: null };
        }
        if (name === 'novelight_comment_feed') {
          return {
            data: [
              {
                id: 'identity-1',
                user_id: userId,
                display_name: '読者',
                avatar_path: null,
                body: '読了しました。',
                created_at: '2026-10-30T01:00:00Z',
                scout_level: 3,
                equipped_badge_id: 'limited_founding_author',
                equipped_badge_name: 'Founding Author #096'
              }
            ],
            error: null
          };
        }
        return { data: true, error: null };
      }
    };
    await globalThis.NovelightComments.mount({
      client,
      novel: { id: '420' },
      session: null,
      isAuthor: false
    });
  });
  const avatar = page.locator('.novelight-comment-avatar img');
  await expect(avatar).toHaveAttribute(
    'src',
    '/assets/scout-badges/reader_read_005.png'
  );
  await expect
    .poll(() => avatar.evaluate((image) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.locator('.novelight-comment-level')).toHaveText(
    'SCOUT Lv.3'
  );
  await expect(page.locator('.novelight-comment-equipped-name')).toHaveText(
    'Founding Author #096'
  );
});
