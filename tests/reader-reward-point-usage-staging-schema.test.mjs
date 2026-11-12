import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL(
    '../docs/plans/SCOUT-FORMAL-POINT-USAGE-STAGING-APPLY-20261111.sql',
    import.meta.url
  ),
  'utf8'
);
const tables = [
  'scout_point_usage_wallets',
  'scout_point_usage_budgets',
  'scout_point_usage_operations',
  'scout_point_usage_events',
  'scout_point_usage_credit_claims'
];

test('Staging SQL creates exactly five existing-draft usage tables', () => {
  const found = [
    ...sql.matchAll(
      /create table if not exists novelight_formal_private\.(scout_point_usage_\w+)/gi
    )
  ].map((m) => m[1]);
  assert.deepEqual(found.sort(), [...tables].sort());
  assert.doesNotMatch(sql, /create table[^;]*scout_level_state/i);
  assert.doesNotMatch(
    sql,
    /create or replace function|create trigger|create policy/i
  );
});

test('each new table has RLS and application roles have no DML grant', () => {
  for (const name of tables) {
    assert.match(
      sql,
      new RegExp(
        'alter table novelight_formal_private\\.' +
          name +
          '\\s+enable row level security',
        'i'
      )
    );
    assert.match(sql, new RegExp('novelight_formal_private\\.' + name, 'i'));
  }
  assert.match(
    sql,
    /revoke all on table[\s\S]+from public, anon, authenticated, service_role;/i
  );
  assert.match(
    sql,
    /revoke all on sequence[\s\S]+from public, anon, authenticated, service_role;/i
  );
  assert.doesNotMatch(sql, /^\s*grant\s+/im);
  assert.doesNotMatch(sql, /revoke all on schema/i);
});

test('wallet/operation/claim constraints and essential indexes are preserved', () => {
  for (const text of [
    'scout_usage_eligible_subset',
    'scout_usage_budget_bound',
    'scout_usage_exchange_floor',
    'scout_usage_exchange_full_eligibility',
    'unique (operation_id, phase)',
    'canonical_point_id uuid primary key',
    'scout_usage_op_pending',
    'scout_usage_op_user',
    'scout_usage_event_user',
    'scout_usage_credit_claim_user'
  ]) {
    assert.ok(sql.includes(text), 'missing: ' + text);
  }
});

test('no balance migration, Point issuance, paid use or legacy LEVEL mutation', () => {
  assert.doesNotMatch(
    sql,
    /^\s*(?:insert\s+into|update\s+|delete\s+from|call\s+|select\s+novelight_formal_private\.award_)/im
  );
  assert.doesNotMatch(
    sql,
    /^\s*(?:alter|drop)\s+(?:table|function)\s+novelight_formal_private\.scout_level/im
  );
  assert.doesNotMatch(sql, /credit_confirmed_formal_point_draft\s*\(/i);
});
