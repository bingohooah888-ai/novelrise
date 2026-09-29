import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../ranking.html', import.meta.url),
  'utf8'
);

test('ranking keeps server order and filters mute/block rows before any render', () => {
  const rankAssignment = source.indexOf('_display_rank:index+1');
  const safetyFilter = source.indexOf(
    'NovelightUserSafety.filterNovelRows(client,rows)'
  );
  const firstRender = source.indexOf('renderInitial(firstRows)');
  assert.ok(rankAssignment >= 0);
  assert.ok(safetyFilter > rankAssignment);
  assert.ok(firstRender > safetyFilter);
  assert.match(source, /novelight_ranking_feed_v2/);
  assert.match(source, /p_limit:100/);
});

test('ranking first DOM batch is capped at 30 and the remainder is progressive', () => {
  assert.match(source, /INITIAL_RENDER_LIMIT=30/);
  assert.match(source, /PROGRESSIVE_RENDER_LIMIT=30/);
  assert.match(source, /rows\.slice\(0,INITIAL_RENDER_LIMIT\)/);
  assert.match(source, /rows\.slice\(INITIAL_RENDER_LIMIT\)/);
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /rootMargin:'600px 0px'/);
});

test('thumbnail hydration is no longer on the critical path for all 100 rows', () => {
  assert.doesNotMatch(
    source,
    /withOfficialThumbnails\(\(r\.data\|\|\[\]\)\.map/
  );
  assert.match(
    source,
    /withOfficialThumbnails\(rows\.slice\(0,INITIAL_RENDER_LIMIT\)\)/
  );
  assert.match(source, /withOfficialThumbnails\(batch\)/);
});
