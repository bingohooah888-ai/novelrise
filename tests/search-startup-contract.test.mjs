import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const searchSource = await readFile(
  new URL('../search.html', import.meta.url),
  'utf8'
);

test('initial search results do not wait for the official tag catalog', () => {
  const startupMarker = '(async()=>{await NovelightClient.captureAcquisition(client);';
  const startupIndex = searchSource.indexOf(startupMarker);

  assert.notEqual(startupIndex, -1, 'search startup bootstrap must remain present');

  const startupSource = searchSource.slice(startupIndex);

  assert.doesNotMatch(startupSource, /await NovelightTags\.mount\(/u);
  assert.match(startupSource, /void NovelightTags\.mount\(/u);
  assert.match(startupSource, /\.then\(mounted=>/u);
  assert.match(startupSource, /await run\(\)/u);

  assert.ok(
    startupSource.indexOf('void NovelightTags.mount(') <
      startupSource.indexOf('await run()'),
    'tag UI initialization should be launched independently before the initial search is awaited'
  );
});
