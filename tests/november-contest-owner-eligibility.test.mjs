import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20261012135000_november_contest_owner_entry_eligibility.sql',
  'utf8'
);
const widget = readFileSync('novelight-contest-entry.js', 'utf8');
const fixture = readFileSync(
  'tests/rls/november-contest-integration.sql',
  'utf8'
);

test('only general/R15 human or assisted works are eligible', () => {
  assert.match(
    migration,
    /w\.content_rating in \('general','sensitive_15','mature'\)/
  );
  assert.match(migration, /w\.ai_usage in \('human','ai_assisted'\)/);
  assert.match(
    migration,
    /v_work\.content_rating not in \('general','sensitive_15','mature'\)/
  );
  assert.match(migration, /v_work\.ai_usage not in \('human','ai_assisted'\)/);
  assert.match(migration, /ineligible_work_category/);
  assert.match(fixture, /Owner R18 work bypassed entry-category gate/);
  assert.match(fixture, /Owner AI-generated work bypassed eligibility/);
  assert.match(fixture, /R15 AI-assisted author work incorrectly excluded/);
});

test('category gate follows ownership and precedes entry writes', () => {
  const ownership = migration.indexOf("'not_owned_published_work'");
  const eligibility = migration.indexOf("'ineligible_work_category'");
  const upsert = migration.indexOf('set novel_id = v_work.id');
  assert.ok(ownership >= 0 && eligibility > ownership);
  assert.ok(upsert > eligibility);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.doesNotMatch(migration, /grant execute[^;]*to anon/i);
  assert.doesNotMatch(migration, /update public\.novels/);
  assert.doesNotMatch(migration, /update public\.novelight_contests/);
});

test('client explains restricted categories and preserves consent', () => {
  assert.match(widget, /ineligible_work_category:/);
  assert.match(widget, /応募対象外の作品区分/);
  assert.match(widget, /button\.disabled = !checkbox\.checked/);
  assert.match(widget, /!checkbox\?\.checked/);
});
