import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const mypage = fs.readFileSync(
  new URL('../mypage.html', import.meta.url),
  'utf8'
);

test('creator home exposes a state-aware beta start guide', () => {
  assert.match(mypage, /id="betaGuide"/);
  assert.match(mypage, /β START GUIDE/);
  assert.match(mypage, /loadAuthorGuide\(\)/);
  assert.match(mypage, /from\('novels'\)/);
  assert.match(mypage, /from\('episodes'\)/);
});

test('new authors are sent to create a work before episode actions', () => {
  assert.match(mypage, /STEP 1 \/ 3/);
  assert.match(mypage, /primaryHref:'post\.html'/);
  assert.match(mypage, /まず、作品の器を1つ作りましょう/);
});

test('authors can choose a first episode or safe bulk migration', () => {
  assert.match(mypage, /STEP 2 \/ 3/);
  assert.match(mypage, /episode-post\.html\?novel_id=/);
  assert.match(mypage, /episode-import\.html\?novel_id=/);
  assert.match(mypage, /最大200話まで非公開下書き/);
});

test('server drafts are routed through review before publication', () => {
  assert.match(mypage, /draftEpisodes\.length/);
  assert.match(mypage, /episode-drafts\.html\?novel_id=/);
  assert.match(mypage, /下書きはまだ読者には見えません/);
});

test('authors with a published episode are guided to discovery analytics', () => {
  assert.match(mypage, /STEP 3 \/ 3/);
  assert.match(mypage, /primaryHref:'analytics\.html'/);
  assert.match(mypage, /読者へ何回表示され/);
});

test('onboarding is derived from existing state and adds no persistence or mutation', () => {
  assert.doesNotMatch(mypage, /localStorage\.(?:setItem|removeItem).*guide/);
  assert.doesNotMatch(mypage, /from\('profiles'\)\.update\([^)]*guide/);
  assert.doesNotMatch(mypage, /insert\([^)]*guide/);
});
