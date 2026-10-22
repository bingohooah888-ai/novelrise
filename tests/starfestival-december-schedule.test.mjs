import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const load = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const migration = load('../supabase/migrations/20261022203000_starfestival_december_schedule.sql');
const terms = load('../api/_lib/contest-terms-template.js');
const termsAPI = load('../api/contest-terms.js');
const entry = load('../novelight-contest-entry.js');
const home = load('../index.html');
const startPlan = load('../scripts/november-contest-start-plan.mjs');

test('reschedule preserves original contest key and existing entries', () => {
  assert.match(migration, /contest_key='novelight-november-2026'/);
  assert.match(migration, /status <> 'registration'/);
  assert.match(migration, /novelight_contest_read_events/);
  assert.match(migration, /novelight_contest_rank_snapshots/);
  assert.match(migration, /novelight_contest_awards/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.novelight_contest_entries/i);
  assert.doesNotMatch(migration, /update\s+public\.novelight_contest_entries/i);
  assert.match(migration, /'december-2026-v2'/);
});
test('atomic production dates and all three noon ranking slots use JST', () => {
  for (const date of ['2026-12-07','2026-12-15','2026-12-22'])
    assert.match(migration, new RegExp(date + ' 03:00:00[+]00'));
  assert.match(migration, /2026-11-30 14:59:59\.999999[+]00/);
  assert.match(migration, /2026-11-30 15:00:00[+]00/);
  assert.match(migration, /2026-12-31 15:00:00[+]00/);
  assert.match(startPlan, /c\.starts_at <> '2026-11-30 15:00:00[+]00'/);
  assert.match(startPlan, /c\.ends_at <> '2026-12-31 15:00:00[+]00'/);
});
test('amended terms are versioned and old accepted entries can re-consent', () => {
  assert.match(terms, /'december-2026-v2'/);
  assert.match(terms, /2026年11月30日（月）/);
  assert.match(terms, /2026年12月31日（木）/);
  assert.match(terms, /2027年1月1日以降/);
  assert.match(termsAPI, /LEGACY_CONTEST_TERMS_VERSION/);
  assert.match(migration, /'terms_accepted_version', v_entry\.terms_accepted_version/);
  assert.match(entry, /改訂要項に再同意/);
  assert.match(home, /エントリー締切 2026年11月30日/);
});
