import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const home = await readFile('index.html', 'utf8');
const post = await readFile('post.html', 'utf8');
const login = await readFile('login.html', 'utf8');

test('homepage hero CTAs are hidden until guest auth is verified', () => {
  assert.ok(
    home.includes(
      'id="homeHeroActions" class="home-hero-actions" ' +
        'aria-label="NOVELIGHTを利用する" hidden'
    )
  );
  assert.ok(
    home.includes(
      '.home-hero-actions[hidden] { display: none !important; }'
    )
  );
  assert.ok(home.includes('href="search.html">作品を探す</a>'));
  assert.ok(home.includes('href="post.html">小説を投稿する</a>'));
  assert.ok(home.includes("client.auth.getSession()"));
  assert.ok(home.includes("client.auth.onAuthStateChange((event,session)=>"));
  assert.ok(home.includes("event==='INITIAL_SESSION'"));
  assert.ok(home.includes("event==='SIGNED_IN'"));
  assert.ok(home.includes("event==='SIGNED_OUT'"));
  assert.ok(home.includes('actions.hidden=Boolean(session)'));
  assert.ok(home.includes('if(!authEventReceived)update(data?.session||null)'));
});

test('homepage places recommendations after optional hero CTAs', () => {
  const hero = home.indexOf('class="home-promo-carousel"');
  const buttons = home.indexOf('id="homeHeroActions"');
  const discover = home.indexOf('id="discover"');
  assert.ok(hero >= 0 && buttons > hero && discover > buttons);
  assert.ok(!home.includes('class="home-seo-intro"'));
  assert.ok(!home.includes('id="features"'));
  assert.ok(!home.includes('なぜNOVELIGHTなのか'));
  assert.ok(
    home.includes(
      '<h1 class="home-heading-a11y">' +
        'NOVELIGHT（ノベライト）｜小説投稿サイト</h1>'
    )
  );
  assert.ok(home.includes('.home-heading-a11y { position: absolute;'));
  assert.ok(!home.includes('href="#features"'));
  assert.equal(
    home.split('href="author-features.html">特徴</a>').length - 1,
    2
  );
});

test('guest author CTA preserves login and return to post', () => {
  assert.ok(post.includes("window.location.href='login.html?redirect=post.html'"));
  assert.ok(login.includes('const redirectTarget=NovelightAuthReturn.safeRedirectTarget(redirect)'));
  assert.ok(login.includes('window.location.href=redirectTarget'));
  assert.ok(login.includes('signupLink.href=NovelightAuthReturn.authHref'));
});
