import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

test('home enhancement loads the reader CTA patch and keeps the hero redesign out of scope', async () => {
  const loader = await readFile(
    new URL('../auth-reader-context.js', import.meta.url),
    'utf8'
  );
  const enhancement = await readFile(
    new URL('../novelight-home-resume.js', import.meta.url),
    'utf8'
  );

  assert.match(loader, /novelight-home-resume\.js/u);
  assert.match(enhancement, /小説を読む/u);
  assert.match(enhancement, /無料で始める/u);
  assert.match(enhancement, /読者は完全無料/u);
  assert.match(enhancement, /links\[0\]\.href = 'search\.html'/u);
  assert.match(enhancement, /links\[1\]\.href = 'signup\.html'/u);
});
