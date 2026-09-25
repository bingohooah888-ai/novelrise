import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [shellCss, homeCss] = await Promise.all([
  readFile('novelight-author-studio-shell.css', 'utf8'),
  readFile('novelight-author-home.css', 'utf8')
]);

for (const [name, css] of [
  ['shared shell', shellCss],
  ['author home shell', homeCss]
]) {
  test(`${name} keeps navigation typography aligned with creator content`, () => {
    assert.match(css, /Author Studio shell navigation typography alignment/u);
    assert.match(css, /\.studio-label[\s\S]*font-size:14px!important/u);
    assert.match(css, /\.studio-nav a[\s\S]*font-size:18px!important/u);
    assert.match(css, /\.nav-icon[\s\S]*font-size:20px!important/u);
    assert.match(css, /\.sidebar-quote[\s\S]*font-size:16px!important/u);
    assert.match(css, /\.workspace-top > \.reader-home-link[\s\S]*font-size:18px!important/u);
    assert.match(css, /\.account-text strong[\s\S]*font-size:18px!important/u);
    assert.match(css, /\.logout[\s\S]*font-size:17px!important/u);
  });
}
