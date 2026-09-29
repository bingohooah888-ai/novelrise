import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../ranking.html', import.meta.url), 'utf8');

test('ranking keeps server order and assigns display rank before safety filtering', () => {
  const rankIndex = source.indexOf("_display_rank:index+1");
  const safetyIndex = source.indexOf('NovelightUserSafety.filterNovelRows(client,rows)');
  const renderIndex = source.indexOf('await renderProgressively(rows,current)');
  assert.ok(rankIndex >= 0);
  assert.ok(safetyIndex > rankIndex);
  assert.ok(renderIndex > safetyIndex);
  assert.match(source, /novelight_ranking_feed_v2/);
  assert.match(source, /p_limit:100/);
});

test('ranking renders only the first 24 safe rows initially', () => {
  assert.match(source, /RANKING_INITIAL_RENDER_COUNT=24/);
  assert.match(source, /RANKING_RENDER_BATCH=24/);
  assert.match(source, /count=offset===0\?RANKING_INITIAL_RENDER_COUNT:RANKING_RENDER_BATCH/);
  assert.match(source, /rows\.slice\(offset,offset\+count\)/);
});

test('ranking progressively appends the remainder with IntersectionObserver', () => {
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /rootMargin:'900px 0px'/);
  assert.match(source, /sentinel\.insertAdjacentHTML\('beforebegin',html\)/);
  assert.match(source, /stopProgressiveRender\(\)/);
});

test('ranking does not render muted or blocked rows before filtering', () => {
  const safetyIndex = source.indexOf('NovelightUserSafety.filterNovelRows(client,rows)');
  const progressiveIndex = source.indexOf('await renderProgressively(rows,current)');
  assert.ok(safetyIndex >= 0 && progressiveIndex > safetyIndex);
  assert.doesNotMatch(source.slice(0, safetyIndex), /renderProgressively\(rows,current\)/);
});

test('thumbnail lookup is batch-scoped instead of blocking on all 100 rows', () => {
  assert.match(source, /baseBatch=rows\.slice\(offset,offset\+count\)/);
  assert.match(source, /withOfficialThumbnails\(baseBatch\)/);
  assert.doesNotMatch(source, /withOfficialThumbnails\(\(r\.data\|\|\[\]\)/);
});
