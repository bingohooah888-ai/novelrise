import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [mypage, baseCss, roomCss] = await Promise.all([
  readFile('mypage.html', 'utf8'),
  readFile('novelight-author-home.css', 'utf8'),
  readFile('novelight-author-room.css', 'utf8')
]);

test('author room uses the supplied background artwork with the night-study workspace shell', () => {
  assert.match(mypage, /class="studio-sidebar"/u);
  assert.match(mypage, /AUTHOR STUDIO/u);
  assert.match(mypage, /さんの創作室/u);
  assert.match(mypage, /class="author-hero"/u);
  assert.match(mypage, /href="novelight-author-home\.css"/u);
  assert.match(mypage, /href="novelight-author-room\.css"/u);
  assert.match(baseCss, /--author-hero-art:none/u);
  assert.match(roomCss, /author-room-hero-background\.webp/u);
  assert.match(roomCss, /author-room-sidebar-background\.webp/u);
  assert.match(roomCss, /author-room-activity-background\.webp/u);
  assert.match(roomCss, /author-room-profile-background\.webp/u);
  assert.match(roomCss, /content:none!important/u);
  assert.match(roomCss, /color:#f7f1e5!important;/u);
  assert.match(roomCss, /color:#e7c466!important/u);
  assert.match(roomCss, /background:transparent!important;/u);
  assert.match(roomCss, /novelight-author-room-logo\.webp/u);
  assert.match(mypage, /LIGHT ANALYTICS・直近30日/u);
  assert.match(mypage, /作品に最近起きたこと/u);
});

test('author room keeps supplied artwork visible on desktop and protected on mobile', () => {
  assert.match(
    roomCss,
    /linear-gradient\(90deg,rgba\(2,13,25,.82\) 0%,rgba\(2,13,25,.52\) 43%,rgba\(2,13,25,.13\) 72%,rgba\(2,13,25,.03\) 100%\)/u
  );
  assert.match(
    roomCss,
    /linear-gradient\(90deg,rgba\(2,14,27,.88\) 0%,rgba\(2,14,27,.64\) 54%,rgba\(2,14,27,.22\) 100%\)/u
  );
  assert.match(
    roomCss,
    /linear-gradient\(90deg,rgba\(2,14,27,.90\) 0%,rgba\(2,14,27,.72\) 54%,rgba\(2,14,27,.32\) 100%\)/u
  );
  assert.match(
    roomCss,
    /@media\(max-width:900px\)\{[\s\S]*?rgba\(2,14,27,.94\)[\s\S]*?rgba\(2,14,27,.95\)/u
  );
  assert.match(roomCss, /backdrop-filter:blur\(2px\)/u);
});

test('author room sidebar keeps the logo readable over its artwork', () => {
  assert.match(
    roomCss,
    /\.studio-brand,[\s\S]*?gap:0!important;[\s\S]*?padding:0 0 8px!important;/u
  );
  assert.match(roomCss, /border:0!important;/u);
  assert.match(roomCss, /border-radius:0!important;/u);
  assert.match(roomCss, /box-shadow:none!important;/u);
  assert.match(
    roomCss,
    /\.studio-brand img,[\s\S]*?display:none!important;/u
  );
  assert.match(
    roomCss,
    /\.studio-brand small,[\s\S]*?display:none!important;/u
  );
  assert.match(mypage, /<div class="studio-label">AUTHOR STUDIO<\/div>/u);
});

test('author room header emphasizes navigation and author name without the account subtitle', () => {
  assert.match(roomCss, /\.workspace-top>a\{font-size:16px!important\}/u);
  assert.match(roomCss, /\.account-text strong\{font-size:16px!important\}/u);
  assert.match(roomCss, /\.account-text span\{display:none!important\}/u);
});

test('author room action and analytics copy keep readable wrapping and sizing', () => {
  assert.match(
    roomCss,
    /\.action-card h2\{[\s\S]*?font-size:19px!important;[\s\S]*?white-space:nowrap!important;/u
  );
  assert.match(
    roomCss,
    /\.action-card p\{[\s\S]*?text-wrap:pretty;[\s\S]*?word-break:auto-phrase;/u
  );
  assert.match(
    roomCss,
    /\.plan\{[\s\S]*?background:transparent!important;[\s\S]*?-webkit-text-fill-color:#c7edff!important;/u
  );
  assert.match(roomCss, /\.label\{font-size:16px!important\}/u);
  assert.match(roomCss, /\.sub\{font-size:14px!important\}/u);
  assert.match(roomCss, /\.value\{font-size:28px!important\}/u);
});

test('author room keeps the plan CTA stable', () => {
  assert.match(roomCss, /\.action-card\.cyan \.status\{/u);
  assert.match(roomCss, /min-height:0!important;/u);
  assert.match(roomCss, /margin-top:0!important;/u);
  assert.match(roomCss, /\.action-card\.cyan \.status:not\(:empty\)\{/u);
  assert.match(roomCss, /min-height:17px!important;/u);
  assert.match(roomCss, /margin-top:7px!important;/u);
});

test('author room keeps readable card density on midsize desktop widths', () => {
  assert.match(
    roomCss,
    /@media\(min-width:901px\) and \(max-width:1400px\)\{[\s\S]*?\.action-grid,\.metrics\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important\}/u
  );
});

test('author room keeps all five primary author actions', () => {
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
    /\.avatar-label\{[\s\S]*?font-size:11px!important;[\s\S]*?white-space:nowrap!important;/u
  );
});

test('author room stacks recent activity before profile settings on mobile', () => {
  assert.match(
    roomCss,
    /@media\(max-width:900px\)\{[\s\S]*?\.activity-panel\{[\s\S]*?order:1!important\}[\s\S]*?\.profile-panel\{[\s\S]*?order:2!important\}/u
  );
});

test('author room source order follows recent activity before profile settings', () => {
  const activityIndex = mypage.indexOf('id="activityHeading"');
  const profileIndex = mypage.indexOf('id="profileHeading"');
  assert.notEqual(activityIndex, -1);
  assert.notEqual(profileIndex, -1);
  assert.ok(activityIndex < profileIndex);
  assert.doesNotMatch(
    mypage,
    /\.profile-panel\{order:1\}\.activity-panel\{order:2\}/u
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
