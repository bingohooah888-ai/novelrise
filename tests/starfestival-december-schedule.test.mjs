import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

function load(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const migration = load(
  '../supabase/migrations/20261022203000_starfestival_december_schedule.sql'
);
const terms = load('../api/_lib/contest-terms-template.js');
const termsAPI = load('../api/contest-terms.js');
const entry = load('../novelight-contest-entry.js');
const home = load('../index.html');
const plan = load('../scripts/november-contest-start-plan.mjs');

test('original contest key and existing entries remain unchanged', () => {
  assert.ok(migration.includes("contest_key='novelight-november-2026'"));
  assert.ok(migration.includes("v_contest.status = 'registration'"));
  assert.ok(migration.includes("v_contest.status = 'draft'"));
  assert.ok(migration.includes('novelight_contest_read_events'));
  assert.ok(migration.includes('novelight_contest_rank_snapshots'));
  assert.ok(migration.includes('novelight_contest_awards'));
  const protectedTable = 'public.novelight_contest_entries';
  assert.ok(!migration.includes('delete from ' + protectedTable));
  // The reschedule itself must not rewrite entries. The new RPC may
  // update consent fields only in the author's explicit reacceptance action.
  const setupSql = migration.split('create or replace function')[0];
  assert.ok(!setupSql.includes('update ' + protectedTable));
  assert.ok(migration.includes('december-2026-v2'));
});

test('schedule migrates deadline, start, end and ranking slots', () => {
  assert.ok(migration.includes('2026-11-30 14:59:59.999999+00'));
  assert.ok(migration.includes('2026-11-30 15:00:00+00'));
  assert.ok(migration.includes('2026-12-31 15:00:00+00'));
  for (const day of ['07', '15', '22']) {
    assert.ok(migration.includes('2026-12-' + day + ' 03:00:00+00'));
  }
  assert.ok(plan.includes("c.starts_at <> '2026-11-30 15:00:00+00'"));
  assert.ok(plan.includes("c.ends_at <> '2026-12-31 15:00:00+00'"));
});

test('terms are versioned and previous entrants can re-consent', () => {
  assert.ok(terms.includes('december-2026-v2'));
  assert.ok(terms.includes('2026年11月30日（月）'));
  assert.ok(terms.includes('12月31日（木）'));
  assert.ok(terms.includes('2027年1月1日以降'));
  assert.ok(termsAPI.includes('LEGACY_CONTEST_TERMS_VERSION'));
  assert.ok(migration.includes("'terms_accepted_version'"));
  assert.ok(entry.includes('改訂要項に再同意'));
  const section = migration.split(`if v_entry.status = 'entered'\n`)[1];
  const reconsent = section?.split('end if;')[0] ?? '';
  assert.ok(reconsent.includes('terms_accepted_at = v_now'));
  assert.ok(reconsent.includes("'terms_reaccepted'"));
  assert.ok(reconsent.includes("'previous_terms_version'"));
  assert.ok(reconsent.includes("'state', 'terms_updated'"));
  assert.ok(!reconsent.includes('entered_at = v_now'));
  assert.ok(home.includes('エントリー締切 2026年11月30日'));
});
