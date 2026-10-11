import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const searchSource = await readFile(
  new URL('../search.html', import.meta.url),
  'utf8'
);

test('initial search results do not wait for the official tag catalog', () => {
  const startupMarker =
    '(async()=>{await NovelightClient.captureAcquisition(client);';
  const startupIndex = searchSource.indexOf(startupMarker);

  assert.notEqual(
    startupIndex,
    -1,
    'search startup bootstrap must remain present'
  );

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

test('search cards prioritize title and include public dates', () => {
  const card = searchSource.slice(searchSource.indexOf('function card(n)'));
  const titleIndex = card.indexOf('<div class="title">');
  const tagsIndex = card.indexOf('${tagMarkup}');
  assert.ok(titleIndex >= 0 && titleIndex < tagsIndex);
  assert.ok(card.indexOf('data-novelight-synopsis') < tagsIndex);
  assert.match(card, /作品登録日/u);
  assert.match(card, /最終投稿日/u);
  assert.match(searchSource, /novelight_public_discovery_card_state/u);
  assert.match(
    searchSource,
    /latest_published_at:publicationMap\.get\(key\)\|\|null/u
  );
});

test('search tips and official tags are next to search inputs', () => {
  const form = searchSource.indexOf('id="searchArea"');
  const tips = searchSource.indexOf('id="searchTipsPanel"');
  const tags = searchSource.indexOf('id="tagFilterPanel"');
  assert.ok(form >= 0 && form < tips && tips < tags);
  assert.match(searchSource, /<summary>検索のコツ<\/summary>/u);
  assert.match(searchSource, /<summary>公式タグで絞り込む<\/summary>/u);
});
