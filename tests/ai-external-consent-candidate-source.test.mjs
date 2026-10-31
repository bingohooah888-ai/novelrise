import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const ROOT = '../supabase/';
const MIGRATION = '20261031023000_novelight_ai_external_consent';
async function source(path) {
  return readFile(new URL(ROOT + path, import.meta.url), 'utf8');
}

test('candidate consent SQL is guarded and remains private and disabled', async () => {
  const sql = await source('migrations/' + MIGRATION + '.sql');
  assert.match(sql, /^begin;$/mu);
  assert.match(sql, /^commit;$/mu);
  assert.match(sql, /enable row level security/u);
  assert.match(sql, /to service_role using \(true\) with check \(true\)/u);
  assert.match(sql, /from public, anon, authenticated;/u);
  assert.match(sql, /security invoker/u);
  assert.match(sql, /current_user <> 'service_role'/u);
  assert.match(sql, /enabled=false/u);
  assert.match(sql, /interval '30 days'/u);
  assert.match(sql, /novelight_ai_external_consent_action_audit/u);
  assert.doesNotMatch(sql, /security definer/iu);
  assert.doesNotMatch(sql, /^rollback;$/mu);
});

test('precheck, postcheck and recovery preserve authorization boundaries', async () => {
  const pre = await source('checks/' + MIGRATION + '_precheck.sql');
  const post = await source('checks/' + MIGRATION + '_postcheck.sql');
  const recovery = await source('rollback/' + MIGRATION + '_rollback.sql');
  assert.match(pre, /review candidates must be empty/u);
  assert.match(pre, /enabled=false/u);
  assert.match(post, /has_table_privilege/u);
  assert.match(post, /has_function_privilege/u);
  assert.match(post, /prosecdef/u);
  assert.match(post, /consent or audit rows already exist/u);
  assert.match(recovery, /MANUAL RECOVERY ONLY/u);
  assert.match(recovery, /preserve all consent audit evidence/u);
  assert.doesNotMatch(recovery, /CASCADE;/u);
  assert.doesNotMatch(recovery, /\bsupabase_migrations\./u);
});
