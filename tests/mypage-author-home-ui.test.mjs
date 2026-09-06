import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [mypage, baseCss, roomCss] = await Promise.all([
  readFile('mypage.html', 'utf8'),
  readFile('novelight-author-home.css', 'utf8'),
  readFile('novelight-author-room.css', 'utf8'),
]);

test('author room uses the night-study workspace shell without changing reader discovery', () => {
  assert.match(mypage, /class="studio-sidebar"/u);
  assert.match(mypage, /AUTHOR STUDIO/u);
  assert.match(mypage, /さんの創作室/u);
  assert.match(mypage, /class="author-hero"/u);
  assert.match(mypage, /href="novelight-author-home\.css"/u);
  assert.match(mypage, /href="novelight-author-room\.css"/u);
  assert.match(baseCss, /--author-hero-art:none/u);
  assert.match(roomCss, /#132a3a/u);
  assert.match(roomCss, /#102333/u);
  assert.match(roomCss, /#d8d3c5/u);
  assert.match(roomCss, /#8f9ba5/u);
  assert.match(roomCss, /#d1af61/u);
  assert.match(roomCss, /rgba\(190,155,80,\.14\)/u);
  assert.match(mypage, /LIGHT ANALYTICS・直近30日/u);
  assert.match(mypage, /作品に最近起きたこと/u);
});

test('author room keeps all five primary author actions', () => {
  for (const href of [
    'post.html',
    'my-novels.html',
    'analytics.html',
    'scout-record.html',
    'pricing.html',
  ]) {
    assert.match(mypage, new RegExp(`href="${href.replace('.', '\\.')}"`));
  }
  assert.match(mypage, /小説を投稿/u);
  assert.match(mypage, /自分の作品/u);
  assert.match(mypage, /LIGHT ANALYTICS/u);
  assert.match(mypage, /SCOUT RECORD/u);
  assert.match(mypage, /契約プラン/u);
});

test('profile settings keep avatar and public profile while removing redundant plan and account rows', () => {
  assert.match(mypage, /id="avatarInput"/u);
  assert.match(mypage, /author-avatars/u);
  assert.match(mypage, /id="publicProfileLink"/u);
  assert.match(mypage, /author\.html\?id=/u);
  assert.match(mypage, /読者向け表示を見る/u);
  assert.match(mypage, /id="joinedAt"/u);
  assert.match(mypage, /session\.user\?\.created_at/u);
  assert.match(mypage, /id="profileDisplayName"/u);
  assert.doesNotMatch(mypage, /<dt>アカウント種別<\/dt>/u);
  assert.doesNotMatch(mypage, /id="metaPlan"/u);
  assert.doesNotMatch(mypage, /<dt>現在プラン<\/dt>/u);
  assert.match(mypage, /<h2>契約プラン<\/h2>/u);
});

test('avatar change label stays on one line at the refined size', () => {
  assert.match(
    roomCss,
    /\.avatar-label\{[\s\S]*?font-size:11px!important;[\s\S]*?white-space:nowrap!important;/u,
  );
});

test('author room includes a collapsible mobile menu', () => {
  assert.match(mypage, /id="menuToggle"/u);
  assert.match(mypage, /id="studioSidebar"/u);
  assert.match(baseCss, /@media\(max-width:900px\)/u);
  assert.match(baseCss, /transform:translateX\(-104%\)/u);
  assert.match(mypage, /aria-expanded="false"/u);
  assert.match(mypage, /創作室メニュー/u);
});
