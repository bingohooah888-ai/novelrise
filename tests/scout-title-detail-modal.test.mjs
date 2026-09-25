import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile('novelight-scout-record.css', 'utf8');
const html = await readFile('scout-record.html', 'utf8');

test('Scout title detail dialog is explicitly centered and enlarged', () => {
  assert.match(html, /<dialog id="badgeDialog" class="scout-modal">/u);
  assert.match(css, /\.scout-modal\{[\s\S]*?position:fixed;[\s\S]*?top:50%;[\s\S]*?left:50%;/u);
  assert.match(css, /transform:translate\(-50%,-50%\)/u);
  assert.match(css, /#badgeDialog\.scout-modal\{width:min\(760px,calc\(100vw - 40px\)\)\}/u);
  assert.match(css, /#badgeDialog \.scout-modal-card\{padding:30px\}/u);
});

test('Scout title detail dialog stays centered and viewport-safe on mobile', () => {
  assert.match(css, /\.scout-modal\{width:calc\(100vw - 20px\);max-height:calc\(100dvh - 20px\)\}/u);
  assert.match(css, /#badgeDialog\.scout-modal\{width:calc\(100vw - 20px\)\}/u);
  assert.match(css, /#badgeDialog \.scout-modal-card\{padding:20px\}/u);
});
