import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const postHtml = await readFile(new URL('../post.html', import.meta.url), 'utf8');

test('thumbnail persistence failure cannot enter new-novel cleanup', () => {
  const thumbnailStart = postHtml.indexOf("let thumbnailWarning='';if(composerMode)");
  const redirectStart = postHtml.indexOf(
    "const next=new URLSearchParams(location.search).get('next')",
    thumbnailStart
  );
  assert.ok(thumbnailStart >= 0, 'thumbnail persistence isolation block is present');
  assert.ok(redirectStart > thumbnailStart, 'redirect follows thumbnail isolation block');

  const thumbnailBlock = postHtml.slice(thumbnailStart, redirectStart);
  assert.match(thumbnailBlock, /try\{const saved=await composerController\.persist/);
  assert.match(thumbnailBlock, /catch\(thumbnailError\)/);
  assert.match(
    thumbnailBlock,
    /作品は保存されましたが、サムネイル生成に失敗しました。/
  );
  assert.doesNotMatch(thumbnailBlock, /from\('novels'\)\.delete/);
  assert.doesNotMatch(thumbnailBlock, /throw thumbnailError/);

  const outerCleanup = postHtml.indexOf("client.from('novels').delete()", redirectStart);
  assert.ok(outerCleanup > redirectStart, 'novel cleanup remains outside thumbnail failure block');
});
