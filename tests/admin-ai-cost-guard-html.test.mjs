import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'inline admin script must exist');
  assert.doesNotThrow(() => new Function(script));
});
