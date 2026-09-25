import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile('novelight-scout-record.css', 'utf8');
const html = await readFile('scout-record.html', 'utf8');

test('Scout title detail dialog is centered and enlarged', () => {
  assert.match(html, /id="badgeDialog"/u);
  assert.match(css, /position:fixed/u);
  assert.match(css, /top:50%/u);
  assert.match(css, /left:50%/u);
  assert.match(css, /translate\(-50%,-50%\)/u);
  assert.match(css, /#badgeDialog\.scout-modal/u);
  assert.match(css, /width:min\(760px/u);
  assert.match(css, /calc\(100vw - 40px\)/u);
  assert.match(css, /padding:30px/u);
});

test('Scout title detail dialog is viewport-safe on mobile', () => {
  assert.match(css, /calc\(100vw - 20px\)/u);
  assert.match(css, /calc\(100dvh - 20px\)/u);
  assert.match(css, /padding:20px/u);
});

test('Scout title detail dialog gives artwork and copy more visual weight', () => {
  assert.match(
    css,
    /#badgeDialog \.badge-dialog-artwork img[\s\S]*width:min\(320px,72vw\)!important/u
  );
  assert.match(
    css,
    /#badgeDialog \.scout-modal-head h2[\s\S]*font-size:32px!important/u
  );
  assert.match(
    css,
    /#badgeDialog \.scout-modal-kv span[\s\S]*font-size:17px!important/u
  );
  assert.match(
    css,
    /#badgeDialog \.scout-modal-kv b[\s\S]*font-size:21px!important/u
  );
  assert.match(
    html,
    /class="scout-modal-kv scout-modal-condition"[\s\S]*id="badgeDialogCondition"/u
  );
  assert.match(
    css,
    /#badgeDialog \.scout-modal-condition[\s\S]*grid-column:1 \/ -1/u
  );
});
