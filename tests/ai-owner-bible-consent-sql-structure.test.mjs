import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const file = new URL(
  '../reports/sql/novelight_ai_external_consent_PROPOSAL.sql',
  import.meta.url
);
const dbl = String.fromCharCode(36, 36);

test('consent SQL has precisely two complete dollar-quoted PL/pgSQL functions', async () => {
  const sql = await readFile(file, 'utf8');
  const functions = [
    'novelight_ai_consent_grant',
    'novelight_ai_consent_revoke'
  ];
  // A single $; or an unterminated string was present in the historical
  // proposal. Protect the executable boundaries, not just key phrases.
  assert.equal(sql.split(dbl).length - 1, 4);
  assert.doesNotMatch(sql, /^\s*\$;\s*$/mu);
  const blocks = [
    ...sql.matchAll(
      /create or replace function public\.(novelight_ai_consent_(?:grant|revoke))\([\s\S]*?language plpgsql security invoker set search_path = '' as \$\$([\s\S]*?)\$\$;/gu
    )
  ];
  assert.equal(blocks.length, 2);
  assert.deepEqual(
    blocks.map((block) => block[1]),
    functions
  );
  for (const [, , body] of blocks) {
    assert.match(body, /\bbegin\b/iu);
    assert.match(body, /\bend;\s*$/iu);
    assert.doesNotMatch(body, /-- REQUIRED BEFORE PROMOTION/u);
    assert.match(body, /current_user <> 'service_role'/u);
  }
});

test('grant validation uses a complete SQL regex, not truncated text or comments', async () => {
  const sql = await readFile(file, 'utf8');
  const expression =
    "or p_policy_revision !~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{3,119}" +
    String.fromCharCode(36) +
    "'";
  assert.ok(sql.includes(expression));
  const marker = '-- REQUIRED BEFORE PROMOTION:';
  assert.equal(sql.split(marker).length - 1, 1);
  assert.ok(sql.indexOf(marker) > sql.lastIndexOf('\nrollback;'));
});

test('review-only consent SQL has explicit RLS, narrow grants, audit and rollback', async () => {
  const sql = await readFile(file, 'utf8');
  assert.match(sql, /^-- REVIEW PROPOSAL ONLY;/u);
  assert.equal((sql.match(/^\s*begin;\s*$/gmu) ?? []).length, 1);
  assert.equal((sql.match(/^\s*rollback;\s*$/gmu) ?? []).length, 1);
  assert.equal((sql.match(/^\s*commit;\s*$/gmu) ?? []).length, 0);
  assert.match(sql, /novelight_ai_external_processing_consents/u);
  assert.match(sql, /novelight_ai_external_consent_action_audit/u);
  assert.equal((sql.match(/enable row level security;/gu) ?? []).length, 2);
  assert.match(sql, /from public, anon, authenticated;/u);
  assert.match(
    sql,
    /grant execute on function public\.novelight_ai_consent_grant\(/u
  );
  assert.match(
    sql,
    /grant execute on function public\.novelight_ai_consent_revoke\(/u
  );
  assert.doesNotMatch(sql, /security definer/iu);
  assert.doesNotMatch(sql, /\\(?:connect|copy|!)/iu);
  assert.ok(sql.lastIndexOf('rollback;') > sql.lastIndexOf(dbl));
});

test('Staging metadata probe contains SELECT only and no state mutation', async () => {
  const filename = new URL(
    '../reports/sql/novelight_ai_consent_STAGING_METADATA_READONLY.sql',
    import.meta.url
  );
  const raw = await readFile(filename, 'utf8');
  const sql = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .trim();
  assert.match(sql, /^select\s/iu);
  assert.equal(sql.split(';').filter((part) => part.trim()).length, 1);
  const withoutQuotedLiterals = sql.replace(/'(?:''|[^'])*'/gu, "''");
  assert.doesNotMatch(
    withoutQuotedLiterals,
    /\b(?:insert|update|delete|create|alter|drop|truncate|grant|revoke|commit|rollback|execute|call)\b/iu
  );
});
