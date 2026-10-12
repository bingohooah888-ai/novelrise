import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const migrationPath =
  '../supabase/migrations/20261012134000_november_contest_terms_consent.sql';
const sql = readFileSync(new URL(migrationPath, import.meta.url), 'utf8');
const widget = readFileSync(
  new URL('../novelight-contest-entry.js', import.meta.url),
  'utf8'
);
const fixture = readFileSync(
  new URL('../tests/rls/november-contest-integration.sql', import.meta.url),
  'utf8'
);

test('an unapproved terms URL/version cannot activate registration', () => {
  assert.match(sql, /terms_version text not null default ''/);
  assert.match(sql, /terms_url text not null default ''/);
  assert.match(sql, /novelight_contest_registration_terms_required/);
  assert.match(sql, /status not in \('registration','active'\)/);
  assert.match(sql, /novelight\[.\]jp/);
  assert.match(
    fixture,
    /Unconfigured official contest terms allowed activation/
  );
});

test('entry v2 stores acceptance for new and replaced work', () => {
  assert.match(sql, /novelight_contest_entry_action_v2/);
  assert.match(sql, /p_terms_version is distinct from v_contest.terms_version/);
  assert.match(sql, /terms_accepted_version = v_contest.terms_version/);
  assert.match(sql, /terms_accepted_at = v_now/);
  assert.match(sql, /v_contest.terms_version, v_now/);
  assert.match(sql, /terms_accepted_version is null/);
  assert.match(sql, /terms_accepted_at is null/);
  assert.match(fixture, /server-recorded contest terms acceptance evidence/);
});

test('legacy clients cannot bypass terms acceptance', () => {
  assert.match(sql, /if p_action = 'withdraw' then/);
  assert.match(sql, /'ok', false, 'reason', 'terms_consent_required'/);
  assert.match(
    sql,
    /revoke all on function public.novelight_contest_entry_action\(text,bigint,text\)/
  );
  assert.match(
    sql,
    /grant execute on function\s+public.novelight_contest_entry_action_v2/
  );
  assert.match(fixture, /Legacy entry bypassed terms consent/);
  assert.match(fixture, /Wrong terms version bypassed consent/);
});

test('entry client requires an unchecked-by-default consent checkbox', () => {
  assert.match(widget, /checkbox.type = 'checkbox'/);
  assert.match(widget, /checkbox.dataset.contestConsent/);
  assert.match(
    widget,
    /const button = createButton\(label, 'enter', work.id, true\)/
  );
  assert.match(widget, /button.disabled = !checkbox.checked/);
  assert.match(widget, /!checkbox\?\.checked/);
  assert.match(widget, /context.terms_version/);
  assert.match(widget, /noopener noreferrer/);
  assert.match(widget, /novelight_contest_entry_action_v2/);
  assert.doesNotMatch(widget, /innerHTML/);
});

test('RPC sends version for enter, none for withdrawal', async () => {
  const window = {};
  new Function('window', 'document', widget)(window, {});
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { ok: true }, error: null };
    }
  };
  const api = window.NovelightContestEntry;
  await api.submitAction(client, 'enter', 123, 'official-v1');
  await api.submitAction(client, 'withdraw', null);
  assert.equal(calls[0].name, 'novelight_contest_entry_action_v2');
  assert.equal(calls[0].args.p_novel_id, 123);
  assert.equal(calls[0].args.p_terms_version, 'official-v1');
  assert.equal(calls[1].args.p_terms_version, null);
});
