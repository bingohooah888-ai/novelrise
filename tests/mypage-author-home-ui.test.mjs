import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [mypage, css] = await Promise.all([
  readFile('mypage.html', 'utf8'),
  readFile('novelight-author-home.css', 'utf8')
]);

test('author home uses the night-study workspace shell without changing reader discovery', () => {
  assert.match(mypage, /class="studio-sidebar"/u);
  assert.match(mypage, /AUTHOR STUDIO/u);
  assert.match(mypage, /class="author-hero"/u);
  assert.match(mypage, /href="novelight-author-home\.css"/u);
  assert.match(css, /--author-hero-art:none/u);
  assert.match(mypage, /LIGHT ANALYTICS・直近30日/u);
  assert.match(mypage, /作品に最近起きたこと/u);
  assert.match(mypage, /まだ新しい出来事はありません。/u);
});

test('author home keeps all five primary author actions', () => {
  for (const href of [
    'post.html',
    'my-novels.html',
    'analytics.html',
    'scout-record.html',
    'pricing.html'
  ]) {
    assert.match(mypage, new RegExp(`href="${href.replace('.', '\\.')}"`));
  }
  assert.match(mypage, /小説を投稿/u);
  assert.match(mypage, /自分の作品/u);
  assert.match(mypage, /LIGHT ANALYTICS/u);
  assert.match(mypage, /SCOUT RECORD/u);
  assert.match(mypage, /契約プラン/u);
});

test('author home preserves live analytics and profile data hooks', () => {
  assert.match(mypage, /novelight_author_exposure_funnel_v2/u);
  assert.match(mypage, /id="joinedAt"/u);
  assert.match(mypage, /session\.user\?\.created_at/u);
  assert.match(mypage, /id="profileDisplayName"/u);
  assert.match(mypage, /id="metaPlan"/u);
});

test('author home includes a collapsible mobile author menu', () => {
  assert.match(mypage, /id="menuToggle"/u);
  assert.match(mypage, /id="studioSidebar"/u);
  assert.match(css, /@media\(max-width:900px\)/u);
  assert.match(css, /transform:translateX\(-104%\)/u);
  assert.match(mypage, /aria-expanded="false"/u);
});

test('author home suppresses the legacy duplicate dashboard and keeps the modern palette', () => {
  assert.match(
    css,
    /body\.novelight-theme\.novelight-page-mypage \.novelight-author-sidebar\{display:none!important\}/u
  );
  assert.match(
    css,
    /body\.novelight-theme\.novelight-page-mypage main\.novelight-author-shell\{[\s\S]*?display:block;/u
  );
  assert.match(css, /filter:brightness\(0\) invert\(1\)/u);
  assert.match(css, /--author-font:"Yu Mincho"/u);
  assert.match(css, /body\.novelight-theme\.novelight-page-mypage \.action-card h2\{color:#fff8e8\}/u);
  assert.match(css, /body\.novelight-theme\.novelight-page-mypage \.metric\{/u);
  assert.match(css, /body\.novelight-theme\.novelight-page-mypage \.panel\{/u);
});
