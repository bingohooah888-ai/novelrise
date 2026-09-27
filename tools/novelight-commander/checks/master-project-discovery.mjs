import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../src/master-project-sync.js', import.meta.url), 'utf8');

test('project discovery supports existing project pages and project links', () => {
  assert.match(source, /findExistingProjectPage/);
  assert.match(source, /collectNamedProjectLinks/);
  assert.match(source, /\/g\/g-p-/);
});

test('project discovery records diagnostics instead of silently guessing', () => {
  assert.match(source, /project_links=/);
  assert.match(source, /visible_exact_matches=/);
});
