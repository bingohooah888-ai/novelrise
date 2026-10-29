import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const oldSource = read(
  '../supabase/migrations/20261005112000_scout_campaign_entry_windows.sql'
);
const migration = read(
  '../supabase/migrations/20261029142000_' +
    'exclude_internal_scout_campaign_entries.sql'
);
const fixture = read('./rls/scout-campaign-internal-exclusion.sql');
const start =
  'create or replace function public.novelight_capture_scout_campaign_entry()';
const stop =
  '\nrevoke all on function public.novelight_capture_scout_campaign_entry()';
const oldFunction = oldSource.split(start)[1]?.split(stop)[0];
const newFunction = migration.split(start)[1]?.split(stop)[0];

test('internal E2E guard preserves campaign eligibility', () => {
  assert.ok(oldFunction && newFunction);
  const guard = `begin
  -- Application metadata is admin-managed; do not enroll synthetic tests.
  if pg_catalog.lower(coalesce(new.raw_app_meta_data ->> 'internal_e2e', 'false'))
       in ('true', '1', 'yes') then
    return new;
  end if;

`;
  assert.equal(newFunction, oldFunction.replace('begin\n', guard));
  assert.match(
    migration,
    /revoke all on function public\.novelight_capture_scout_campaign_entry\(\)/u
  );
  assert.match(migration, /pg_catalog\.to_regprocedure/u);
  assert.match(migration, /fcf216ef3062983bea13ff4143b92f53/u);
  assert.doesNotMatch(
    migration,
    /drop trigger|delete from|update public\.scout_reward_campaigns/iu
  );
});

test('disposable DB tests internal exclusion and normal signup', () => {
  assert.match(fixture, /begin;/u);
  assert.match(fixture, /internal_e2e/u);
  assert.match(fixture, /ci-normal-campaign@example\.invalid/u);
  assert.match(fixture, /<> 0/u);
  assert.match(fixture, /<> 1/u);
  assert.match(fixture, /rollback;/u);
});
