import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pages = [
  ['post.html', 'page-title'],
  ['my-novels.html', 'head'],
  ['author-notes.html', 'page-head'],
  ['analytics.html', 'analytics-hero'],
  ['interaction-settings.html', 'page-head'],
  ['account-settings.html', 'page-head']
];

test('creator pages use only the shared frameless page-heading treatment', async () => {
  for (const [path, nativeClass] of pages) {
    const source = await readFile(path, 'utf8');
    assert.ok(source.includes('novelight-page-heading.css'), path);
    assert.match(
      source,
      new RegExp('class="[^"]*' + nativeClass + '[^"]*novelight-page-heading[^"]*"'),
      path
    );
    assert.ok(!source.includes('novelight-author-studio-pages.css'), path);
    assert.ok(!source.includes('novelight-author-ui'), path);
  }
});

test('page-heading stylesheet cannot restyle page typography or content surfaces', async () => {
  const styles = await readFile('novelight-page-heading.css', 'utf8');
  assert.match(styles, /padding:\s*0\s*!important/);
  assert.match(styles, /border:\s*0\s*!important/);
  assert.match(styles, /border-radius:\s*0\s*!important/);
  assert.match(styles, /background:\s*transparent\s*!important/);
  assert.match(styles, /box-shadow:\s*none\s*!important/);
  assert.doesNotMatch(styles, /font-size|font-family|\.panel|\.card|input|select|textarea/);
});
