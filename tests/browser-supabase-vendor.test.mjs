import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { normalizeEol } from './test-text-utils.mjs';

const root = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);
const vendorPath = path.join(root, 'assets/vendor/supabase-js-2.112.3.js');
const installedPath = path.join(
  root,
  'node_modules/@supabase/supabase-js/dist/umd/supabase.js'
);

test('browser Supabase runtime is exact-pinned and vendored from the installed package', () => {
  assert.equal(packageJson.dependencies['@supabase/supabase-js'], '2.112.3');
  assert.equal(
    normalizeEol(fs.readFileSync(vendorPath, 'utf8')),
    normalizeEol(fs.readFileSync(installedPath, 'utf8'))
  );
  const attributes = normalizeEol(
    fs.readFileSync(path.join(root, '.gitattributes'), 'utf8')
  );
  assert.match(attributes, /^\* text=auto eol=lf$/mu);
  assert.match(attributes, /^assets\/vendor\/supabase-js-\*\.js -text$/mu);
  assert.match(
    fs.readFileSync(
      path.join(root, 'assets/vendor/supabase-js-LICENSE.txt'),
      'utf8'
    ),
    /MIT License/
  );
});

test('browser pages do not depend on jsDelivr for Supabase at runtime', () => {
  const pages = fs.readdirSync(root).filter((name) => name.endsWith('.html'));
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.doesNotMatch(
      html,
      /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/,
      page
    );
    if (html.includes('supabase.createClient')) {
      assert.match(html, /\/assets\/vendor\/supabase-js-2\.112\.3\.js/, page);
    }
  }
});
