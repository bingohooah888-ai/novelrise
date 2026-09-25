import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const live = await readFile(
  'scripts/production-audit-004-005-smoke.mjs',
  'utf8'
);
const transaction = await readFile(
  'tests/production/audit-004-005-transaction-smoke.sql',
  'utf8'
);

test('AUDIT-004 Production smoke covers real RPC abuse boundaries', () => {
  assert.match(live, /EXPECTED_PRODUCTION_REVISION/u);
  assert.match(live, /novelight_bulk_import_episode_drafts/u);
  assert.match(live, /Array\.from\(\{ length: 101 \}/u);
  assert.match(live, /'x'\.repeat\(100_001\)/u);
  assert.match(live, /5 requests per 10 minutes/u);
  assert.match(live, /Promise\.all/u);
  assert.match(live, /already accepted/u);
  assert.match(live, /bulk_import_requests/u);
  assert.match(live, /raw ledger RLS/u);
  assert.match(live, /fixture cleanup/u);
});

test('AUDIT-005 Production smoke covers server identity, dedupe, rate, and bypass denial', () => {
  assert.match(live, /\/api\/analytics-event/u);
  assert.match(live, /visitor_token: clientTokenA/u);
  assert.match(live, /visitor_token: clientTokenB/u);
  assert.match(live, /assert\.notEqual\(touches\[0\]\.visitor_key_hash/u);
  assert.match(live, /user_id: other\.id/u);
  assert.match(live, /journeyIdentity\[0\]\.user_id, analytics\.id/u);
  assert.match(live, /recorded_count,\s*0/u);
  assert.match(live, /novelight_record_scout_record_visit/u);
  assert.match(live, /record_acquisition_touch/u);
  assert.match(live, /record_reader_journey_event/u);
  assert.match(live, /record_episode_pv/u);
  assert.match(live, /record_neutral_search_impressions/u);
  assert.match(live, /rateCampaignPrefix/u);
  assert.match(live, /fingerprint\|visitor_key/u);
});

test('Production quota smoke is transaction-scoped and rolls every fixture back', () => {
  assert.match(transaction, /^begin;/u);
  assert.match(transaction, /20260924091509/u);
  assert.match(transaction, /> 20000000/u);
  assert.match(transaction, /v_count > 100/u);
  assert.match(transaction, /v_body_char_count > 5000000/u);
  assert.match(transaction, /generate_series\(1, 1999\)/u);
  assert.match(transaction, /Daily bulk import request limit exceeded/u);
  assert.match(transaction, /Daily bulk import episode limit exceeded/u);
  assert.match(transaction, /Daily bulk import character limit exceeded/u);
  assert.match(transaction, /Daily bulk import analytics limit exceeded/u);
  assert.match(transaction, /Daily acquisition event limit exceeded/u);
  assert.match(transaction, /Reader journey daily limit exceeded/u);
  assert.match(transaction, /Episode PV daily limit exceeded/u);
  assert.match(transaction, /Neutral search daily limit exceeded/u);
  assert.match(transaction, /SCOUT daily visit limit/u);
  assert.match(transaction, /rollback;/u);
  assert.match(transaction, /transaction_fixture_rolled_back/u);
  assert.doesNotMatch(
    transaction,
    /\b(?:create|alter|drop)\s+(?:table|function)/iu
  );
});
