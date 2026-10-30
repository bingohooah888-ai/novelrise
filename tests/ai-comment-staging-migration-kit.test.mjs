import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const base = '20261030010000_comment_public_scout_identity';
const location = (part) => new URL(part, import.meta.url);
const files = {
  pre: location('../supabase/checks/' + base + '_precheck.sql'),
  post: location('../supabase/checks/' + base + '_postcheck.sql'),
  rollback: location('../supabase/rollback/' + base + '_rollback.sql'),
  migration: location('../supabase/migrations/' + base + '.sql')
};

test('Staging-only precheck requires exact legacy fingerprint, candidate RLS and ledger', async () => {
  const source = await readFile(files.pre, 'utf8');
  assert.match(source, /92dd0172a48e9c35deb38eb8ba75f4cf/u);
  assert.match(source, /20261028084410/u);
  assert.match(source, /20261030010000/u);
  assert.match(source, /novelight_ai_review_candidates/u);
  assert.match(source, /relrowsecurity/u);
  assert.match(source, /count\(\*\)[\s\S]*<> 0/u);
  assert.match(source, /has_function_privilege\('anon'/u);
  assert.match(source, /has_function_privilege\('authenticated'/u);
  assert.match(source, /has_function_privilege\('service_role'/u);
  assert.doesNotMatch(source, /\b(?:insert|update|delete|drop|truncate)\s+(?:into\s+|from\s+)?(?:public|supabase_migrations)\./iu);
});

test('postcheck expects already observed Production fingerprint without changing candidates', async () => {
  const source = await readFile(files.post, 'utf8');
  assert.match(source, /9883e151750cf28b49c30a2b4a286e9d/u);
  assert.match(source, /20261028084410/u);
  assert.match(source, /20261030010000/u);
  assert.match(source, /novelight_ai_review_candidates/u);
  assert.match(source, /relrowsecurity/u);
  assert.match(source, /has_function_privilege\('anon'/u);
  assert.doesNotMatch(source, /\b(?:insert|update|delete|drop|truncate)\s+(?:into\s+|from\s+)?(?:public|supabase_migrations)\./iu);
});

test('recovery uses pinned exact Staging function source and never repairs ledger silently', async () => {
  const source = await readFile(files.rollback, 'utf8');
  assert.match(source, /RECOVERY ONLY/u);
  assert.match(source, /NEVER run automatically/iu);
  assert.match(source, /92dd0172a48e9c35deb38eb8ba75f4cf/u);
  assert.match(source, /9883e151750cf28b49c30a2b4a286e9d/u);
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.novelight_comment_feed_scope\(/u);
  assert.match(source, /SECURITY DEFINER/u);
  assert.match(source, /SET search_path TO ''/u);
  assert.match(source, /revoke all on function public\.novelight_comment_feed_scope\(/u);
  assert.match(source, /^begin;$/mu);
  assert.match(source, /^commit;$/mu);
  assert.doesNotMatch(source, /\b(?:insert|update|delete|truncate)\s+(?:into\s+|from\s+)?supabase_migrations\.schema_migrations/iu);
});

test('reconciliation kit never changes the existing Production-applied migration', async () => {
  const migration = await readFile(files.migration, 'utf8');
  assert.match(migration, /^-- Surface existing opt-in public title/u);
  assert.match(migration, /security definer/u);
  assert.match(migration, /revoke all on function public\.novelight_comment_feed_scope/u);
});
