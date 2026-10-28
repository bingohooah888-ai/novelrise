import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRECHECK_SQL,
  assertPrecheck
} from '../scripts/ai-review-hosted-proof-census.mjs';

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
        fingerprint: '32dc9047f332d6a1a7bddae7f7538a6d'
      },
      {
        table: 'novels',
        count: 9,
        fingerprint: 'df0282d8ad64a429118e5057e57d20a2'
      },
      {
        table: 'profiles',
        count: 3,
        fingerprint: 'dc74a4cb78131f7375191c4edb2799f0'
      },
      {
        table: 'users',
        count: 6,
        fingerprint: '573355b7a9d1bcf2ae224721af2ffa1b'
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
    'df0282d8ad64a429118e5057e57d20a2';
  entry.triggerFingerprints.push({ table: 'payments', count: 1 });
  assert.throws(() => assertPrecheck(entry), /AI_HOSTED_RACE_CENSUS_DENIED/u);
});
