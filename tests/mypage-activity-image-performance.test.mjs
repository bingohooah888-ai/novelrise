import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runtime = await readFile(
  new URL('../novelight-scout-title-toast.js', import.meta.url),
  'utf8'
);
const mypage = await readFile(
  new URL('../mypage.html', import.meta.url),
  'utf8'
);

test('mypage 46px activity icons use a 96px Vercel display derivative', () => {
  assert.match(
    mypage,
    /icon\.className='activity-icon';icon\.src=activityIcon\(row\.activity_type\)/
  );
  assert.match(runtime, /installMypageActivityImageOptimization/);
  assert.match(runtime, /this\.classList\?\.contains\('activity-icon'\)/);
  assert.match(runtime, /buildOptimizedAssetUrl\(original, 96\)/);
  assert.match(runtime, /\/_vercel\/image\?url=/);
});

test('activity image optimization preserves the master URL and layout contract', () => {
  assert.match(runtime, /this\.dataset\.originalSrc = original/);
  assert.match(runtime, /this\.width = 46/);
  assert.match(runtime, /this\.height = 46/);
  assert.match(runtime, /this\.loading = 'lazy'/);
  assert.match(runtime, /this\.decoding = 'async'/);
  assert.match(runtime, /this\.fetchPriority = 'low'/);
  assert.match(
    mypage,
    /\.activity-icon\{display:block;width:46px;height:46px;object-fit:contain\}/
  );
});

test('activity optimization is isolated to mypage activity icons', () => {
  assert.match(runtime, /if \(page !== 'mypage'/);
  assert.match(runtime, /activity-icon/);
  assert.doesNotMatch(runtime, /assets\/author-room\/[^'"`]+\.png\s*=/);
});
