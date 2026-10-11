import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shareRuntime = await readFile('novelight-public-share.js', 'utf8');
const sharedLoader = await readFile('novelight-scout-title-toast.js', 'utf8');

test('public share links always use the official NOVELIGHT origin', () => {
  assert.match(
    shareRuntime,
    /const CANONICAL_ORIGIN = 'https:\/\/novelight\.jp';/
  );
  assert.doesNotMatch(shareRuntime, /location\.origin/);
  assert.doesNotMatch(shareRuntime, /vercel\.app/);
});

test('work sharing includes public page, copy, and X actions', () => {
  assert.match(shareRuntime, /公開ページを見る/);
  assert.match(shareRuntime, /URLをコピー/);
  assert.match(shareRuntime, /Xでシェア/);
  assert.match(shareRuntime, /twitter\.com\/intent\/tweet/);
  assert.match(shareRuntime, /canonicalUrl\('novel\.html', novelId\)/);
  assert.match(shareRuntime, /state\.textContent\.includes\('公開中'\)/);
});

test('episode sharing is mounted above and below the episode body', () => {
  assert.match(shareRuntime, /canonicalUrl\('episode\.html', episodeId\)/);
  assert.match(shareRuntime, /position: 'episode-top'/);
  assert.match(shareRuntime, /position: 'episode-bottom'/);
  assert.match(shareRuntime, /titleNode\.after/);
  assert.match(shareRuntime, /content\.after/);
});

test('shared site runtime loads sharing only on intended surfaces', () => {
  assert.match(sharedLoader, /novelight-public-share\.js/);
  assert.match(sharedLoader, /novelight-x-image-share\.js/);
  assert.match(sharedLoader, /\['my-novels', 'novel', 'episode'\]/);
  assert.match(sharedLoader, /data-novelight-public-share-runtime/);
});
