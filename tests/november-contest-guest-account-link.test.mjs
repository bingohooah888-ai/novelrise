import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const source = readFileSync(
  new URL(
    '../supabase/migrations/20261013162500_november_contest_guest_account_link.sql',
    import.meta.url
  ),
  'utf8'
);
const rollback = readFileSync(
  new URL(
    '../supabase/rollback/20261013162500_november_contest_guest_account_link_rollback.sql',
    import.meta.url
  ),
  'utf8'
);

test('guest claiming is one atomic provisional transaction', () => {
  assert.match(source, /for update/);
  assert.match(source, /review_status = 'merged'/);
  assert.match(source, /merged_into_reader_id = v_account[.]id/);
  assert.match(
    source,
    /on conflict \(contest_id,reader_id,episode_id_snapshot\) do nothing/
  );
  assert.match(source, /entry[.]author_id <> p_user_id/);
  assert.match(source, /not in \('provisional','cleared'\)/);
  assert.match(source, /'guest_account_link_provisional'/);
  assert.match(source, /novelight_contest_recompute_reader_score/);
  assert.match(source, /to service_role/);
  assert.match(source, /from public,anon,authenticated/);
});

test('rollback refuses to erase irreversible guest linking history', () => {
  assert.match(rollback, /Guest links exist: manual audited recovery required/);
  assert.match(rollback, /raise exception/);
});
