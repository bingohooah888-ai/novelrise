import { expect, test } from '../fixtures/diagnostic-fixture.js';

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

test('SPECIAL LIGHT header matches Home on desktop and mobile', async ({
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

    for (const zone of ['ai', 'r15', 'r18']) {
      const zoneResponse = await page.goto(`/special-zone.html?zone=${zone}`, {
        waitUntil: 'domcontentloaded'
      });
      expect(
        zoneResponse?.ok(),
        `${viewport.name}: ${zone} zone should load`
      ).toBeTruthy();
      expect(
        await capturePublicHeader(page),
        `${viewport.name}: ${zone} SPECIAL zone header must match Home exactly`
      ).toEqual(baseline);
    }

    await context.close();
  }
});
