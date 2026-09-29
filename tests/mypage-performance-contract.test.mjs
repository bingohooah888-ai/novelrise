import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../mypage.html', import.meta.url), 'utf8');

test('recent activity icons use optimized small derivatives without rewriting masters', () => {
  assert.match(source, /function optimizedActivityIcon\(path\)/);
  assert.match(source, /\/_vercel\/image\?url=/);
  assert.match(source, /&w=96&q=80/);
  assert.match(source, /dataset\.novelightOriginalSrc=originalIcon/);
  assert.match(source, /icon\.loading='lazy'/);
  assert.match(source, /icon\.width=46/);
  assert.match(source, /icon\.height=46/);
  assert.doesNotMatch(source, /icon\.src=activityIcon\(row\.activity_type\)/);
});

test('author guide no longer downloads every episode row', () => {
  assert.doesNotMatch(source, /from\('episodes'\)\.select\('id,novel_id,status,episode_number,created_at'\)[\s\S]*order\('created_at'/);
  assert.match(source, /eq\('status','draft'\)[\s\S]*limit\(1\)/);
  assert.match(source, /eq\('status','published'\)[\s\S]*limit\(1\)/);
  assert.match(source, /select\('id,novel_id,episode_number,created_at',\{count:'exact'\}\)/);
  assert.doesNotMatch(source, /select\([^)]*body/);
});
