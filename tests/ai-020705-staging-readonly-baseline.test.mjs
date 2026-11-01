import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import { AI_020705_STAGING_BASELINE_SQL, observe020705StagingBaseline } from
  '../.github/staging-ai-02-07-05/staging-readonly-baseline.mjs';

const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const MAIN = 'a'.repeat(40);
const NOW = Date.parse('2026-11-01T09:00:00Z');
// prettier-ignore
function row(changes = {}) {
  return {
    runtime_rows: 1, enabled: false,
    user_day_cap_micros: 0, user_month_cap_micros: 0,
    global_day_cap_micros: 0, global_month_cap_micros: 0,
    usage_requests: 0, usage_audit: 0,
    bible_facts: 0, episode_analysis: 0,
    review_candidates: 0, external_consents: 0,
    external_consent_audit: 0, one_shot_claims: 0,
    tombstone_rls: true, invoker_claim_routines: 1,
    anon_executable_claim_routines: 0,
    authenticated_executable_claim_routines: 0,
    service_executable_claim_routines: 1,
    ...changes
  };
}
// prettier-ignore
function setup(changes = {}, resultChanges = {}) {
  const calls = [];
  const queryReadOnly = async (arg) => {
    calls.push(arg);
    return {
      projectRef: STAGING,
      rows: [row(changes)],
      ...resultChanges
    };
  };
  return {calls, queryReadOnly};
}

// prettier-ignore
test('fixed SQL contains SELECT and no destructive operation', () => {
  assert.match(AI_020705_STAGING_BASELINE_SQL, /^SELECT\s/u);
  assert.doesNotMatch(AI_020705_STAGING_BASELINE_SQL,
    /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL)\b/iu);
  assert.ok(AI_020705_STAGING_BASELINE_SQL.includes('novelight_ai_020705_one_shot_claims'));
});
// prettier-ignore
test('Staging OFF, zero residuals and service-only one-shot are observed but NOT authorized', async () => {
  const {calls, queryReadOnly} = setup();
  const value = await observe020705StagingBaseline({
    projectRef: STAGING, mainSha: MAIN, queryReadOnly, now: () => NOW
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['projectRef', 'sql']);
  assert.equal(calls[0].projectRef, STAGING);
  assert.equal(value.state, 'STAGING_OFF_ZERO_AND_CLAIM_ACL_OBSERVED');
  assert.equal(value.runtimeOffZeroObserved, true);
  assert.equal(value.claimAccessBoundaryObserved, true);
  assert.equal(value.authenticatedOriginVerified, false);
  assert.equal(value.independentExitVerified, false);
  assert.equal(value.syntheticCleanupVerified, false);
  assert.equal(value.authorizesPreview, false);
  assert.equal(value.authorizesStagingWrite, false);
  assert.equal(value.authorizesRealJwt, false);
  assert.equal(value.authorizesPaidCall, false);
  assert.equal(value.authorizesAiEnablement, false);
  assert.equal(value.noPaidRetry, true);
});
// prettier-ignore
test('nonzero caps, live AI, usage, or weakened RLS return unsafe, never an approval', async () => {
  for (const change of [
    {enabled: true}, {global_month_cap_micros: 1},
    {usage_requests: 1}, {external_consent_audit: 1},
    {one_shot_claims: 1}, {tombstone_rls: false},
    {anon_executable_claim_routines: 1},
    {authenticated_executable_claim_routines: 1},
    {service_executable_claim_routines: 0}
  ]) {
    const {queryReadOnly} = setup(change);
    const v = await observe020705StagingBaseline({
      projectRef: STAGING, mainSha: MAIN, queryReadOnly, now: () => NOW
    });
    assert.equal(v.state, 'STAGING_BASELINE_NOT_SAFE');
    assert.equal(v.authorizesPaidCall, false);
  }
});
// prettier-ignore
test('missing table/invalid response, wrong project and stale observation fail closed', async () => {
  for (const resultChanges of [
    {rows: []}, {rows: [row(), row()]},
    {rows: [row({runtime_rows: 0})]},
    {rows: [row({usage_requests: null})]},
    {projectRef: 'fiepaguycecrredwrcwx'}
  ]) {
    const {queryReadOnly} = setup({}, resultChanges);
    await assert.rejects(observe020705StagingBaseline({
      projectRef: STAGING, mainSha: MAIN, queryReadOnly, now: () => NOW
    }), /AI_020705_STAGING_BASELINE_DENIED/u);
  }
  const {calls, queryReadOnly} = setup();
  await assert.rejects(observe020705StagingBaseline({
    projectRef: 'fiepaguycecrredwrcwx', mainSha: MAIN,
    queryReadOnly, now: () => NOW
  }), /AI_020705_STAGING_BASELINE_DENIED/u);
  assert.equal(calls.length, 0);
  let tick = 0;
  await assert.rejects(observe020705StagingBaseline({
    projectRef: STAGING, mainSha: MAIN,
    queryReadOnly, now: () => NOW + (tick++ ? 30001 : 0)
  }), /AI_020705_STAGING_BASELINE_DENIED/u);
});
// prettier-ignore
test('database errors never leak raw credentials or private errors', async () => {
  await assert.rejects(observe020705StagingBaseline({
    projectRef: STAGING, mainSha: MAIN,
    queryReadOnly: async () => {
      throw new Error('PRIVATE_DATABASE_SECRET');
    }, now: () => NOW
  }), e => e.message === 'AI_020705_STAGING_BASELINE_DENIED');
});
