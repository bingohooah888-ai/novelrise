import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

for (const page of ['episode-post.html', 'episode-edit.html']) {
  const html = read(page);

  test(`${page} keeps the writing field scrollable without resizing it on every keystroke`, () => {
    assert.match(html, /#content\{width:100%;height:clamp\(560px,72vh,920px\)!important/);
    assert.match(html, /#content\{height:clamp\(480px,64svh,720px\)!important/);
    assert.match(html, /resize:none;overflow-y:auto;scrollbar-gutter:stable/);
    assert.doesNotMatch(html, /resizeContent/);
    assert.match(html, /addEventListener\('input',markDirty\)/);
  });

  test(`${page} does not pin authoring tools over the writing caret`, () => {
    assert.match(html, /\.editor-toolbar\{position:relative;top:auto/);
    assert.doesNotMatch(html, /\.editor-toolbar\{position:sticky/);
    assert.doesNotMatch(html, /\.editor-toolbar\{top:6px/);
  });
}

test('illustration visual mode does not retain a huge offscreen source field', () => {
  const visual = read('novelight-episode-visual-editor.js');
  assert.match(visual, /#content\.nl-visual-source\{display:none!important\}/);
  assert.match(visual, /editor\.scrollTop = scrollTop/);
  assert.match(visual, /editor\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(visual, /left:-100000px/);
});

test('illustration insertion never focuses the hidden source field', () => {
  const illustrations = read('novelight-episode-illustrations.js');
  assert.match(illustrations, /const visualActive = visualEditor\?\.isActive\?\.\(\) === true/);
  assert.match(illustrations, /if \(visualActive\) visualEditor\.sync\(\)/);
  assert.match(illustrations, /if \(!visualActive\) textarea\.focus\(\{ preventScroll: true \}\)/);
  assert.match(illustrations, /textarea\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
});
