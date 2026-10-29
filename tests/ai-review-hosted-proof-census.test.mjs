import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRECHECK_SQL,
  assertPrecheck
} from '../.github/staging-ai-proof/census.mjs';

function snapshot() {
  return {
    migrationCount: 1,
    candidateCount: 0,
    runtimeSafe: true,
    reservedAuthCount: 0,
    reservedNovelCount: 0,
    reservedEpisodeCount: 0,
    functionFingerprints: [
      {
        function: 'novelight_capture_scout_campaign_entry',
        fingerprint: 'fcf216ef3062983bea13ff4143b92f53'
      },
      {
        function: 'novelight_is_internal_participation_account',
        fingerprint: 'aa1d87b299d789535f9e06571979b7ba'
      },
      {
        function: 'novelight_sync_user_participation_qualifications',
        fingerprint: '504d6dac6c932d0ed919a1e703ede89c'
      },
      {
        function: 'sync_auth_user_participation_after_delete',
        fingerprint: '8e67c239903d18194cabf631015f7a14'
      }
    ],
    triggerFingerprints: [
      {
        table: 'episodes',
        count: 7,
        fingerprint: '3dc083fec719753df2e0da09f5dc0a30'
      },
      {
        table: 'novels',
        count: 9,
        fingerprint: '161076c63bc71a6f174f9699fe7aa285'
      },
      {
        table: 'profiles',
        count: 3,
        fingerprint: '99d2b001caf60357f38c90dbd58fc6bc'
      },
      {
        table: 'users',
        count: 6,
        fingerprint: '1a534e511428bd56bd1518ff8daad95a'
      }
    ]
  };
}

test('read-only census checks all four trigger families', () => {
  assert.equal(assertPrecheck(snapshot()), true);
  assert.match(PRECHECK_SQL, /supabase_migrations\.schema_migrations/u);
  assert.match(PRECHECK_SQL, /novelight_ai_runtime_settings/u);
  // Postgres E'\\\\n' is a literal backslash-n in this JS template literal.
  // This guard preserves the audited actual-newline aggregate fingerprints.
  assert.equal(PRECHECK_SQL.match(/chr\(10\)/gu)?.length, 2);
  assert.doesNotMatch(PRECHECK_SQL, /E'\\\\n'/u);
  assert.doesNotMatch(PRECHECK_SQL, /\b(?:insert|update|delete|drop)\b/iu);
});

for (const field of [
  'migrationCount',
  'candidateCount',
  'reservedAuthCount',
  'reservedNovelCount',
  'reservedEpisodeCount'
]) {
  test('census rejects nonempty or absent ' + field, () => {
    const entry = snapshot();
    entry[field] = field === 'migrationCount' ? 0 : 1;
    assert.throws(() => assertPrecheck(entry), /AI_HOSTED_RACE_CENSUS_DENIED/u);
  });
}

test('census rejects AI runtime or spending gate changes', () => {
  const entry = snapshot();
  entry.runtimeSafe = false;
  assert.throws(() => assertPrecheck(entry), /AI_HOSTED_RACE_CENSUS_DENIED/u);
});

test('census rejects Production ref', () => {
  assert.throws(
    () => assertPrecheck(snapshot(), 'fiepaguycecrredwrcwx'),
    /AI_HOSTED_RACE_CENSUS_DENIED/u
  );
});

test('census rejects changed or new triggers', () => {
  const entry = snapshot();
  entry.triggerFingerprints[1].fingerprint = '0'.repeat(32);
  assert.throws(() => assertPrecheck(entry), /AI_HOSTED_RACE_CENSUS_DENIED/u);
  entry.triggerFingerprints[1].fingerprint = '161076c63bc71a6f174f9699fe7aa285';
  entry.triggerFingerprints.push({ table: 'payments', count: 1 });
  assert.throws(() => assertPrecheck(entry), /AI_HOSTED_RACE_CENSUS_DENIED/u);
});

test('census refuses transitive participation logic changes', () => {
  const entry = snapshot();
  entry.functionFingerprints[1].fingerprint = '0'.repeat(32);
  assert.throws(() => assertPrecheck(entry), /AI_HOSTED_RACE_CENSUS_DENIED/u);
});

test('census refuses omitted function fingerprints', () => {
  const entry = snapshot();
  entry.functionFingerprints.pop();
  assert.throws(() => assertPrecheck(entry), /AI_HOSTED_RACE_CENSUS_DENIED/u);
});
