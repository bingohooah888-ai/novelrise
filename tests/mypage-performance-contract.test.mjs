import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../mypage.html', import.meta.url), 'utf8');

test('author start guide does not download every episode row', () => {
  assert.doesNotMatch(
    source,
    /from\('episodes'\)\.select\('id,novel_id,status,episode_number,created_at'\)/,
  );
  assert.match(source, /select\('id',\{count:'exact',head:true\}\)/);
  assert.match(source, /eq\('status','published'\)/);
  assert.match(source, /eq\('status','draft'\)/);
  assert.ok((source.match(/\.limit\(1\)/g) || []).length >= 2);
});

test('small activity artwork uses a derived image while retaining the master path', () => {
  assert.match(source, /function optimizedActivityIcon\(/);
  assert.match(source, /\/_vercel\/image\?url=/);
  assert.match(source, /&w=96&q=82/);
  assert.match(source, /dataset\.novelightOriginalSrc=activityIcon/);
  assert.match(source, /icon\.loading='lazy'/);
  assert.match(source, /icon\.decoding='async'/);
  assert.match(source, /icon\.width=46/);
  assert.match(source, /icon\.height=46/);
});
