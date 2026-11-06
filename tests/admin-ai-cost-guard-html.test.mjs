import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const source = readFileSync(
  new globalThis.URL('../admin.html', import.meta.url),
  'utf8'
);

test('admin HOME includes a dedicated cost guard alert surface', () => {
  assert.match(source, /id="aiCostGuard"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /\/api\/admin-ai-cost-guard/);
});

test('admin HOME inline script stays syntactically valid', () => {
  const openTag = '<script>';
  const closeTag = '</script>';
  const start = source.indexOf(openTag);
  const end = source.indexOf(closeTag, start + openTag.length);
  assert.ok(start >= 0 && end > start, 'inline admin script must exist');
  const script = source.slice(start + openTag.length, end);
  assert.doesNotThrow(() => new Script(script));
});
