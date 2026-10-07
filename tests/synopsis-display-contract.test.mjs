import assert from 'node:assert/strict';
import { readTextSync as readFileSync } from './test-text-utils.mjs';
import test from 'node:test';
import { URL } from 'node:url';

const novel = readFileSync(new URL('../novel.html', import.meta.url), 'utf8');
const fold = readFileSync(new URL('../novelight-synopsis-fold.js', import.meta.url), 'utf8');
const search = readFileSync(new URL('../search.html', import.meta.url), 'utf8');
const ranking = readFileSync(new URL('../ranking.html', import.meta.url), 'utf8');

test('work detail shows the full synopsis without the list clamp marker', () => {
  const render = novel.match(
    /function renderNovel\(\)\{[\s\S]*?\}\nasync function loadFullNovelAndRender/u
  );

  assert.ok(render, 'renderNovel must be present');
  assert.match(
    render[0],
    /<div class="description">\$\{esc\(novel\.description\|\|''\)\}<\/div>/u
  );
  assert.doesNotMatch(render[0], /data-novelight-synopsis/u);
  assert.doesNotMatch(render[0], /data-novelight-synopsis-lines/u);
});

test('list surfaces keep collapsible synopsis markers', () => {
  assert.match(search, /data-novelight-synopsis/u);
  assert.match(ranking, /data-novelight-synopsis/u);
});

test('synopsis overflow detection compares expanded and clamped heights', () => {
  const refresh = fold.match(
    /function refreshHost\(host\) \{[\s\S]*?\n  \}\n\n  function scheduleRefresh/u
  );

  assert.ok(refresh, 'refreshHost must be present');
  assert.match(
    refresh[0],
    /host\.classList\.add\('is-expanded'\);[\s\S]*const fullHeight = copy\.getBoundingClientRect\(\)\.height;[\s\S]*host\.classList\.remove\('is-expanded'\);[\s\S]*const clampedHeight = copy\.getBoundingClientRect\(\)\.height;/u
  );
  assert.match(refresh[0], /const overflow = fullHeight > clampedHeight \+ 1;/u);
});
