import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCOUT_DEMOTION_ACTIVITY_METRICS,
  buildScoutDemotionActivityEvidence
} from '../api/_lib/reader-reward/demotion-activity.js';

test('the 30-day demotion review requires both approved activity metrics', () => {
  assert.deepEqual(SCOUT_DEMOTION_ACTIVITY_METRICS, [
    'validReadCount',
    'verifiedDiscoverySuccessCount'
  ]);
  const evidence = buildScoutDemotionActivityEvidence({
    validReadCount: 12,
    verifiedDiscoverySuccessCount: 2
  });
  assert.deepEqual(evidence, {
    validReadCount: 12,
    verifiedDiscoverySuccessCount: 2
  });
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.hasOwn(evidence, 'shouldDemote'), false);
});

test('zero activity is preserved as a measured fact, not automatic demotion', () => {
  assert.deepEqual(
    buildScoutDemotionActivityEvidence({
      validReadCount: 0,
      verifiedDiscoverySuccessCount: 0
    }),
    { validReadCount: 0, verifiedDiscoverySuccessCount: 0 }
  );
});

test('missing, forged or invalid metric counts fail closed', () => {
  for (const value of [undefined, null, [], {}, { validReadCount: 1 }]) {
    assert.throws(() => buildScoutDemotionActivityEvidence(value));
  }
  for (const bad of [-1, 1.5, NaN, Infinity, '5', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () =>
        buildScoutDemotionActivityEvidence({
          validReadCount: bad,
          verifiedDiscoverySuccessCount: 0
        }),
      RangeError
    );
    assert.throws(
      () =>
        buildScoutDemotionActivityEvidence({
          validReadCount: 0,
          verifiedDiscoverySuccessCount: bad
        }),
      RangeError
    );
  }
});
