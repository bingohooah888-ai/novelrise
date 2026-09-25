import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile('novelight-scout-record.css', 'utf8');

test('SCOUT detail and help dialogs are explicitly centered and enlarged', () => {
  assert.match(css, /\.scout-modal\{[\s\S]*?position:fixed!important;/u);
  assert.match(css, /inset:0!important;/u);
  assert.match(css, /margin:auto!important;/u);
  assert.match(
    css,
    /#badgeDialog\.scout-modal\{[\s\S]*?width:min\(820px,calc\(100vw - 40px\)\)!important/u
  );
  assert.match(
    css,
    /#scoutHelpDialog\.scout-modal\{[\s\S]*?width:min\(720px,calc\(100vw - 40px\)\)!important/u
  );
  assert.match(css, /\.scout-modal-card\{\s*padding:32px/u);
  assert.match(css, /\.scout-modal h2\{[\s\S]*?font-size:28px/u);
  assert.match(css, /\.badge-dialog-artwork img\{\s*width:min\(280px,48vw\)/u);
  assert.match(
    css,
    /@media\(max-width:600px\)[\s\S]*?width:calc\(100vw - 24px\)!important/u
  );
});
