import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [workflow, verifier, stateCheck, docs] = await Promise.all([
  readFile('.github/workflows/supabase-production.yml', 'utf8'),
  readFile('scripts/verify-production-initial-baseline-state.sh', 'utf8'),
  readFile('supabase/checks/production_initial_schema_baseline_state.sql', 'utf8'),
  readFile('docs/SUPABASE-PRODUCTION-DEPLOY.md', 'utf8')
]);

test('history repair is restricted to one allowlisted selected version', () => {
  assert.match(workflow, /repair_version:/);
  for (const version of [
    '20260815000000',
    '20260819190000',
    '20260822194000'
  ]) {
    assert.match(workflow, new RegExp(`- '${version}'`));
  }
  assert.match(
    workflow,
    /supabase migration repair --status applied "\$REPAIR_VERSION"/
  );
  assert.doesNotMatch(
    workflow,
    /supabase migration repair --status applied 202608\d+/
  );
});

test('history repair requires the selected version to be pending', () => {
  assert.match(workflow, /extract-supabase-pending\.sh/);
  assert.match(
    workflow,
    /grep -Fxq "\$REPAIR_VERSION" \/tmp\/repair-pending\.txt/
  );
  assert.match(workflow, /is not currently pending in Production/);
});

test(
  'initial baseline history repair requires a fresh read-only Production state check',
  () => {
    assert.match(
      workflow,
      /env\.REPAIR_VERSION == '20260815000000'[\s\S]*?verify-production-initial-baseline-state\.sh/
    );
    assert.match(verifier, /database\/query\/read-only/);
    assert.match(verifier, /\$row\.ok == true/);

    for (const table of ['profiles', 'novels', 'episodes', 'favorites']) {
      assert.match(
        stateCheck,
        new RegExp(`to_regclass\\('public\\.${table}'\\)`)
      );
      assert.match(
        verifier,
        new RegExp(`\\$row\\.${table}_exists == true`)
      );
    }
  }
);

test(
  'production deployment docs preserve approval and fail-closed baseline repair semantics',
  () => {
    assert.match(docs, /repair-history.*一度に1version/s);
    assert.match(docs, /4つのhistorical core table/);
    assert.match(docs, /read-only/);
    assert.match(docs, /production-approval/);
    assert.match(docs, /1versionずつ承認・整合/);
  }
);
