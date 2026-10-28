import assert from 'node:assert/strict';
import test from 'node:test';

import { PRECHECK_SQL, assertPrecheck } from '../scripts/ai-review-hosted-proof-census.mjs';

function snapshot() {
  return {
    migrationCount: 1,
    candidateCount: 0,
    runtimeSafe: true,
    reservedAuthCount: 0,
    reservedNovelCount: 0,
    reservedEpisodeCount: 0,
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
  entry.triggerFingerprints[1].fingerprint =
    '161076c63bc71a6f174f9699fe7aa285';
  entry.triggerFingerprints.push({ table: 'payments', count: 1 });
  assert.throws(() => assertPrecheck(entry), /AI_HOSTED_RACE_CENSUS_DENIED/u);
});
