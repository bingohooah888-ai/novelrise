import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

// Exact blobs carried over from previously Staging-applied draft PR #2601.
// Preserving Git blob identity prevents accidental edits during reconciliation.
// It is NOT proof that Production has applied this migration.
const SOURCES = [
  [
    '../supabase/migrations/20261028084410_novelight_ai_review_candidates.sql',
    '8832b4ab9cd54272a5eb07f58d937f2cc14c5082'
  ],
  [
    '../supabase/checks/20261028084410_novelight_ai_review_candidates_precheck.sql',
    'fc8a7f543cff4b217655a821fb4756d6f955ea2b'
  ],
  [
    '../supabase/checks/20261028084410_novelight_ai_review_candidates_postcheck.sql',
    '82a4b8392ea09ee6d4772d71e5627a160989c54c'
  ],
  [
    '../supabase/rollback/20261028084410_novelight_ai_review_candidates_rollback.sql',
    '325a5b9b818ee08e11b09e0336a45423c6191f32'
  ]
];

async function source(path) {
  return readFile(new URL(path, import.meta.url));
}

test('four source artifacts match previously reviewed Git blobs', async () => {
  for (const [path, expected] of SOURCES) {
    const bytes = await source(path);
    const prefix = Buffer.from('blob ' + bytes.length + '\0');
    const blob = createHash('sha1').update(prefix).update(bytes).digest('hex');
    assert.equal(blob, expected, path);
  }
});

test('review candidates are service-only, RLS enabled, default OFF', async () => {
  const migration = (await source(SOURCES[0][0])).toString('utf8');
  assert.match(migration, /enable row level security;/u);
  assert.match(migration, /for all to service_role/u);
  assert.match(
    migration,
    /revoke all on public\.novelight_ai_review_candidates/u
  );
  assert.match(migration, /from public, anon, authenticated;/u);
  assert.match(migration, /security invoker/u);
  assert.match(migration, /current_user <> 'service_role'/u);
  assert.match(
    migration,
    /comment on table public\.novelight_ai_review_candidates/u
  );
  assert.match(migration, /\ncommit;\s*$/u);
  assert.doesNotMatch(migration, /security definer/iu);
});

test('checks and recovery retain approval and no-ledger-repair gates', async () => {
  const pre = (await source(SOURCES[1][0])).toString('utf8');
  const post = (await source(SOURCES[2][0])).toString('utf8');
  const rollback = (await source(SOURCES[3][0])).toString('utf8');
  assert.match(pre, /enabled = false/u);
  assert.match(pre, /user_day_cap_micros = 0/u);
  assert.match(post, /relrowsecurity/u);
  assert.match(post, /ai_review_service_only/u);
  assert.match(post, /has_function_privilege/u);
  assert.match(rollback, /MANUAL RECOVERY ONLY/u);
  assert.match(
    rollback,
    /if exists \(select 1 from public\.novelight_ai_review_candidates\)/u
  );
  assert.doesNotMatch(
    rollback,
    /\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?supabase_migrations\./iu
  );
});

test('Production migration workflow is dry-run only', async () => {
  const workflow = (
    await source('../.github/workflows/supabase-production-auto-deploy.yml')
  ).toString('utf8');
  assert.match(workflow, /supabase db push --linked --dry-run/u);
  assert.doesNotMatch(workflow, /supabase db push --linked --yes/u);
  assert.doesNotMatch(workflow, /supabase migration repair/u);
});
