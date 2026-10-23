import { expect, test } from '../fixtures/diagnostic-fixture.js';

test('Creator mobile menu keeps navy and gold after tapping, hover and focus', async ({
  browser
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true
  });
  const page = await context.newPage();
  await page.route('**/post.html', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: [
        '<!doctype html><html lang="ja"><head>',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<link rel="stylesheet" href="/novelight-theme.css">',
        '<link rel="stylesheet" href="/novelight-author-backgrounds.css">',
        '<link rel="stylesheet" href="/novelight-author-studio-shell.css">',
        '</head><body class="novelight-theme novelight-page-post novelight-author-studio-shell">',
        '<header><div class="header-inner">NOVELIGHT</div></header>',
        '<main id="main-content"><h1>投稿画面</h1></main>',
        '<script>window.supabase={createClient:()=>({auth:{',
        'getSession:async()=>({data:{session:null}}),',
        'signOut:async()=>({error:null})}})};</script>',
        '<script src="/novelight-author-studio-shell.js"></script>',
        '</body></html>'
      ].join('')
    })
  );

  await page.goto('/post.html');
  const toggle = page.locator('#menuToggle');
  const background = 'rgba(3, 17, 31, 0.96)';
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveCSS('background-color', background);
  await toggle.tap();
  await expect(toggle).toHaveText('×');
  await expect(page.locator('#studioSidebar')).toHaveClass(/open/u);
  await expect(toggle).toHaveCSS('background-color', background);
  await toggle.hover();
  await toggle.focus();
  await expect(toggle).toHaveCSS('background-color', background);
  await expect(toggle).toHaveCSS('color', 'rgb(255, 224, 130)');
  await page.touchscreen.tap(375, 700);
  await expect(toggle).toHaveText('☰');
  await expect(toggle).toHaveCSS('background-color', background);
  await context.close();
});

test('Home Back restores the same section offset after async shelf changes', async ({
  page
}) => {
  await page.route('**/index.html', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'Cache-Control': 'no-store' },
      body: [
        '<!doctype html><html lang="ja"><head>',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<script src="/novelight-return-position.js"></script>',
        '<style>body{margin:0}main>section{height:400px}</style>',
        '</head><body><main>',
        '<section id="discover">おすすめ</section>',
        '<section id="new-arrivals">新着</section>',
        '<section id="pricing" style="height:1400px">',
        '<div style="padding-top:170px"><a id="to-other" href="/pricing.html">料金へ</a></div>',
        '</section></main><script>',
        "if(performance.getEntriesByType('navigation')[0]?.type==='back_forward'){",
        "setTimeout(()=>{document.getElementById('discover').style.height='800px';",
        "window.dispatchEvent(new Event('novelight:page-content-ready'));},90);}",
        "window.addEventListener('unload',()=>{});",
        '</script></body></html>'
      ].join('')
    })
  );

  await page.goto('/index.html');
  await page.evaluate(() => {
    const pricing = globalThis.document.getElementById('pricing');
    globalThis.window.scrollTo(0, pricing.offsetTop + 70);
  });
  const position = () =>
    page.evaluate(() => {
      return globalThis.document.getElementById('pricing').getBoundingClientRect().top;
    });
  const before = await position();
  expect(before).toBeCloseTo(-70, 0);
  await page.locator('#to-other').click();
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#pricing')).toBeAttached();
  await page.waitForTimeout(250);
  const after = await position();
  expect(after).toBeGreaterThan(-90);
  expect(after).toBeLessThan(-50);
});
