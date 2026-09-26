import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const collaborationHtml = readFileSync(
  new URL('../collaboration.html', import.meta.url),
  'utf8'
);

test('collaboration page opts into the Author Studio shell', () => {
  assert.match(
    collaborationHtml,
    /<body class="novelight-author-studio-shell">/,
    'the shared Author Studio shell CSS is scoped to the body class'
  );
  assert.match(
    collaborationHtml,
    /<link rel="stylesheet" href="novelight-author-studio-shell\.css">/
  );
  assert.match(
    collaborationHtml,
    /<script src="novelight-author-studio-shell\.js"><\/script>/
  );
});

test('collaboration workspace stays centered with page padding', () => {
  assert.match(
    collaborationHtml,
    /\.workspace\{max-width:1040px;margin:0 auto;padding:32px 28px 48px\}/
  );
  assert.match(
    collaborationHtml,
    /@media\(max-width:760px\)\{\.workspace\{padding:24px 16px 36px\}/
  );
});
