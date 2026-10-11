import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'admin-inquiries.html'),
  'utf8'
);

test('opened inquiry remains high-contrast under shared admin theme', () => {
  const theme = fs.readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'novelight-theme.css'),
    'utf8'
  );
  assert.match(theme, /\.item,\s*\.asset/u);
  assert.match(theme, /border-color: rgba\(214, 164, 71, 0\.24\) !important;/u);
  assert.match(
    html,
    /html body\.novelight-theme\.novelight-page-admin-inquiries #inquiryList \.item\.active,/u
  );
  assert.match(html, /border: 4px solid #ffe043 !important;/u);
  assert.match(html, /background: #243650 !important;/u);
  assert.match(html, /box-shadow: inset 6px 0 0 #ffe043,[^;]*!important;/u);
  assert.match(html, /content: "表示中";/u);
  assert.match(html, /\.item:hover:not\(\.active\)/u);
  assert.match(html, /\.item\{[^}]*border:1px solid #303650;/u);
});

test('selected inquiry follows the opened detail after refresh', () => {
  assert.match(
    html,
    /button\.className='item'\+\(row\.id===selectedId\?' active':''\)/u
  );
  assert.match(html, /function renderDetail\(row\)\{selectedId=row\.id;/u);
  assert.match(html, /renderDetail\(data\.inquiry\);await loadList\(false\)/u);
});
