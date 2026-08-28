import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/supabase-production.yml',
  'utf8'
);
const verifier = await readFile(
  'scripts/verify-production-initial-baseline-state.sh',
  'utf8'
);
const stateCheck = await readFile(
  'supabase/checks/production_initial_schema_baseline_state.sql',
  'utf8'
);
const docs = await readFile('docs/SUPABASE-PRODUCTION-DEPLOY.md', 'utf8');

const versions = ['20260815000000', '20260819190000', '20260822194000'];

test('history repair selects one allowlisted version', () => {
  assert.equal(workflow.includes('repair_version:'), true);
  for (const version of versions) {
    assert.equal(workflow.includes(`- '${version}'`), true);
  }
  assert.equal(
    workflow.includes(
      'supabase migration repair --status applied "$REPAIR_VERSION"'
    ),
    true
  );
  assert.equal(
    workflow.includes('supabase migration repair --status applied 202608'),
    false
  );
});

test('history repair requires the selected version to be pending', () => {
  assert.equal(workflow.includes('extract-supabase-pending.sh'), true);
  assert.equal(
    workflow.includes('grep -Fxq "$REPAIR_VERSION" /tmp/repair-pending.txt'),
    true
  );
  assert.equal(workflow.includes('is not currently pending in Production'), true);
});

test('baseline repair requires a fresh read-only Production check', () => {
  assert.equal(workflow.includes("REPAIR_VERSION == '20260815000000'"), true);
  assert.equal(
    workflow.includes('verify-production-initial-baseline-state.sh'),
    true
  );
  assert.equal(verifier.includes('database/query/read-only'), true);
  assert.equal(verifier.includes('$row.ok == true'), true);

  for (const table of ['profiles', 'novels', 'episodes', 'favorites']) {
    assert.equal(stateCheck.includes(`to_regclass('public.${table}')`), true);
    assert.equal(verifier.includes(`$row.${table}_exists == true`), true);
  }
});

test('docs preserve fail-closed one-version history repair', () => {
  assert.equal(docs.includes('一度に1versionだけ'), true);
  assert.equal(docs.includes('4つのhistorical core table'), true);
  assert.equal(docs.includes('read-only'), true);
  assert.equal(docs.includes('production-approval'), true);
  assert.equal(docs.includes('1versionずつ承認・整合'), true);
});
