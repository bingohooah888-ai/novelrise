import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePaths = [
  'post.html',
  'my-novels.html',
  'author-notes.html',
  'analytics.html',
  'interaction-settings.html',
  'account-settings.html'
];

const [pages, styles] = await Promise.all([
  Promise.all(pagePaths.map(path => readFile(path, 'utf8'))),
  readFile('novelight-author-studio-pages.css', 'utf8')
]);

test('target creator pages share one Author Studio presentation layer', () => {
  for (const [index, source] of pages.entries()) {
    assert.match(
      source,
      /novelight-author-studio-pages\.css/u,
      `${pagePaths[index]} must load the shared creator-page stylesheet`
    );
    assert.match(
      source,
      /<body class="[^"]*novelight-author-ui[^"]*"/u,
      `${pagePaths[index]} must opt into the unified creator-page UI`
    );
  }
});

test('shared typography follows the SCOUT RECORD readability scale', () => {
  assert.match(\n    styles,\n    /font-size:\\s*clamp\\(32px,\\s*4vw,\\s*52px\\)/u\n  );
  assert.match(styles, /font-size:\s*18px/u);
  assert.match(styles, /font-size:\s*28px/u);
  assert.match(styles, /font-size:\s*16px/u);
  assert.match(styles, /font-size:\s*15px/u);
});

test('shared surface keeps the Author Notes dark panel pattern', () => {
  assert.match(styles, /--novelight-studio-bg:\s*#07121e/u);
  assert.match(styles, /--novelight-studio-panel:/u);
  assert.match(styles, /border-radius:\s*18px/u);
  assert.match(styles, /--novelight-studio-line:/u);
  assert.match(styles, /--novelight-studio-input:\s*#091824/u);
});

test('desktop and mobile presentation rules are both defined', () => {
  assert.match(styles, /@media \(max-width:\s*900px\)/u);
  assert.match(styles, /@media \(max-width:\s*700px\)/u);
  assert.match(styles, /@media \(max-width:\s*640px\)/u);
  assert.match(styles, /font-size:\s*30px/u);
  assert.match(styles, /font-size:\s*17px/u);
  assert.match(styles, /font-size:\s*24px/u);
});
