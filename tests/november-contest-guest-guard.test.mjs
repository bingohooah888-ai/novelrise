import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const sql = readFileSync(
  new URL(
    '../supabase/migrations/20261013153500_november_contest_guest_guard.sql',
    import.meta.url
  ),
  'utf8'
);

const api = readFileSync(
  new URL('../api/_lib/november-contest-reader.js', import.meta.url),
  'utf8'
);

test('contest guest issuance uses a private atomic database quota', () => {
  assert.match(sql, /on conflict \(fingerprint\) do update/);
  assert.match(sql, /where g.window_started_at/);
  assert.match(sql, /or g.attempts < 5/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /to service_role/);
  assert.match(api, /x-vercel-forwarded-for/);
  assert.match(api, /novelight_contest_guest_creation_slot/);
  assert.match(api, /GUEST_CREATION_LIMIT/);
  assert.doesNotMatch(api, /x-forwarded-for'\]/);
});
