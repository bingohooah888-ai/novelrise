import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('September 29 inventory gate stays read-only and requires a non-empty catalog', async () => {
  const workflow = await read(
    '.github/workflows/beta-inventory-first-reader-gate.yml'
  );

  assert.match(workflow, /name: NOVELIGHT Beta Inventory First Reader Gate/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /database\/query\/read-only/);
  assert.match(workflow, /published_novels/);
  assert.match(workflow, /published_authors/);
  assert.match(workflow, /published_episodes/);
  assert.match(workflow, /published_novels_without_published_episode/);
  assert.match(workflow, /NOVELIGHT_REQUIRE_PUBLISHED_CATALOG: '1'/);
  assert.match(workflow, /playwright\.production\.config\.mjs/);
  assert.doesNotMatch(workflow, /issues:\s*write/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
});

test('production reader smoke supports the strict inventory-gate mode without changing its default empty-catalog behavior', async () => {
  const readerSmoke = await read('tests/e2e/production/reader-smoke.spec.js');

  assert.match(
    readerSmoke,
    /process\.env\.NOVELIGHT_REQUIRE_PUBLISHED_CATALOG === '1'/
  );
  assert.match(
    readerSmoke,
    /requires at least one published work with a published episode/
  );
});

test('operations runbook defines the September 29 gate and keeps BETA_OPEN blocked on failure', async () => {
  const runbook = await read('docs/BETA-OPERATIONS-RUNBOOK.md');

  assert.match(
    runbook,
    /Content inventory \/ first-reader-path gate — 2026-09-29 JST/
  );
  assert.match(runbook, /NOVELIGHT Beta Inventory First Reader Gate/);
  assert.match(runbook, /campaign state is exactly `AUTHOR_PREOPEN`/);
  assert.match(
    runbook,
    /do \*\*not\*\* perform the 2026-09-30 `BETA_OPEN` cutover/
  );
  assert.match(
    runbook,
    /owner must explicitly decide whether the observed catalog breadth is acceptable/
  );
});
