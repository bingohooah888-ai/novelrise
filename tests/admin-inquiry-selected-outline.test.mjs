import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'admin-inquiries.html'),
  'utf8'
);

test('the opened inquiry keeps a thick yellow selection border independent of hover', () => {
  assert.match(
    html,
    /\.item\.active,\.item\.active:hover\{border:3px solid #ffd84d;padding:10px;/u
  );
  assert.match(html, /\.item:hover\{border-color:#806cff;/u);
  assert.match(html, /\.item\{[^}]*border:1px solid #303650;/u);
});

test('selected inquiry follows the currently displayed detail after list refresh', () => {
  assert.match(html, /button\.className='item'\+\(row\.id===selectedId\?' active':''\)/u);
  assert.match(html, /function renderDetail\(row\)\{selectedId=row\.id;/u);
  assert.match(html, /renderDetail\(data\.inquiry\);await loadList\(false\)/u);
});
