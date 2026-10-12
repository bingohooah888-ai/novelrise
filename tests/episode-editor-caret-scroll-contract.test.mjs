import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (name) => readFileSync(resolve(process.cwd(), name), 'utf8');
const desktopHeight = 'height:clamp(560px,72vh,920px)!important';
const mobileHeight = 'height:clamp(480px,64svh,720px)!important';
const scrollStyle = 'resize:none;overflow-y:auto;scrollbar-gutter:stable';
const hiddenSource = '#content.nl-visual-source{display:none!important}';

for (const page of ['episode-post.html', 'episode-edit.html']) {
  test(`${page}: editor size and autosave remain stable`, () => {
    const html = read(page);
    assert.ok(html.includes(desktopHeight));
    assert.ok(html.includes(mobileHeight));
    assert.ok(html.includes(scrollStyle));
    assert.ok(html.includes("addEventListener('input',markDirty)"));
    assert.ok(!html.includes('resizeContent'));
  });

  test(`${page}: toolbar never sticks over the writing field`, () => {
    const html = read(page);
    assert.ok(html.includes('.editor-toolbar{position:relative;top:auto'));
    assert.ok(!html.includes('.editor-toolbar{position:sticky'));
    assert.ok(!html.includes('.editor-toolbar{top:6px'));
  });
}

test('illustrations preserve the visible editing location', () => {
  const visual = read('novelight-episode-visual-editor.js');
  const illustrations = read('novelight-episode-illustrations.js');
  assert.ok(visual.includes(hiddenSource));
  assert.ok(visual.includes('editor.scrollTop = scrollTop'));
  assert.ok(visual.includes('editor.focus({ preventScroll: true })'));
  assert.ok(!visual.includes('left:-100000px'));
  assert.ok(illustrations.includes('if (visualActive) visualEditor.sync()'));
  assert.ok(illustrations.includes('if (!visualActive) textarea.focus('));
  assert.ok(illustrations.includes('textarea.dispatchEvent(new Event('));
});
