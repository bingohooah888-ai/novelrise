import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
const sql = readFileSync(
  new URL('../scripts/scout-point10x-staging-fingerprint.sql', import.meta.url),
  'utf8'
);
const workflow = readFileSync(
  new URL(
    '../.github/workflows/staging-reader-point-tenfold-proof.yml',
    import.meta.url
  ),
  'utf8'
);
test('only six read-only SQL SELECT statements are present', () => {
  const stmt = sql
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
  assert.equal(stmt.length, 6);
  assert.ok(
    stmt.every((s) =>
      s
        .replace(/^--[^\n]*\n/gm, '')
        .trim()
        .startsWith('SELECT ')
    )
  );
});
test('Point/XP/badge tables and award RPC are independently fingerprinted', () => {
  for (const surface of [
    'scout_point_ledger',
    'scout_badge_definitions',
    'user_scout_badges',
    'scout_point_operator_actions',
    'scout_xp_ledger',
    'novelight_award_level_up_points'
  ]) {
    assert.ok(sql.includes("'" + surface + "' AS surface"), surface);
  }
});
test('all row surfaces order by immutable identifiers', () => {
  assert.ok((sql.match(/ORDER BY/g) || []).length >= 5);
});
test('all row values, status and metadata are fingerprinted, not only SUM', () => {
  assert.ok((sql.match(/to_jsonb\(t\)::text/g) || []).length === 5);
  assert.ok((sql.match(/md5\(/g) || []).length === 6);
  assert.doesNotMatch(sql, /\bSUM\s*\(/iu);
});
test('SQL requires exact signature of existing level-up award function', () => {
  assert.match(
    sql,
    /pg_get_functiondef\('public\.novelight_award_level_up_points\(\)'::regprocedure\)/u
  );
});
test('SQL has no mutation or privileged operation', () => {
  assert.doesNotMatch(
    sql,
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|CALL|DO|EXECUTE|COPY|REFRESH|VACUUM)\b/iu
  );
});
test('workflow uses trusted read-only fingerprint script on all three snapshots', () => {
  assert.equal(
    (
      workflow.match(/-f scripts\/scout-point10x-staging-fingerprint\.sql/g) ||
      []
    ).length,
    3
  );
});
test('workflow compares restore and Staging before any rollback-only SQL', () => {
  assert.ok(
    workflow.indexOf(
      'diff -u /tmp/point10x-staging-before-summary /tmp/point10x-restore-ledger-summary'
    ) <
      workflow.indexOf(
        'Check exact refs again and execute one ROLLBACK-ONLY Staging transaction'
      )
  );
});
test('workflow compares pre/post entire fingerprints', () => {
  assert.match(
    workflow,
    /diff -u \/tmp\/point10x-staging-before-summary \/tmp\/point10x-staging-after-summary/u
  );
});
test('all GitHub actions expressions have two closing braces', () => {
  const expressions = [...workflow.matchAll(/\$\{\{([^}]+)\}\}/g)];
  assert.ok(expressions.length >= 20);
  const removed = workflow.replace(/\$\{\{[^}]+\}\}/g, '');
  assert.doesNotMatch(removed, /\$\{\{/u);
});
