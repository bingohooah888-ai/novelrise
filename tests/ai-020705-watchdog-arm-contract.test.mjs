import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import { matches020705WatchdogArm } from
  '../.github/staging-ai-02-07-05/independent-watchdog-arm.mjs';

const NOW = Date.parse('2026-11-01T08:00:00Z');
// prettier-ignore
const scope = Object.freeze({
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: 'a'.repeat(40),
  previewDeploymentId: 'dpl_synthetic123',
  actorId: '11111111-1111-4111-8111-111111111111',
  runId: 1001,
  approvalCommentId: 777,
  novelId: 41,
  episodeId: 11
});
// prettier-ignore
function receipt() {
  return {
    ...scope,
    kind: 'independent-controller-armed',
    protectedEnvironment: 'staging',
    controllerKind: 'external-independent-supervisor',
    controllerRunId: 3001,
    controllerIsRunner: false,
    killAuthorityVerified: true,
    stagingDisableVerified: true,
    sessionRevocationVerified: true,
    syntheticCleanupVerified: true,
    zeroCensusVerified: true,
    noPaidRetry: true,
    observedAtMs: NOW,
    heartbeatAtMs: NOW - 1000,
    expiresAtMs: NOW + 10000
  };
}
// prettier-ignore
const checks = (r, s = scope, now = NOW) =>
  matches020705WatchdogArm({scope: s, receipt: r, now: () => now});

// prettier-ignore
test('matching synthetic arm receipt validates shape only, not provenance', () => {
  assert.equal(checks(receipt()), true);
});
// prettier-ignore
test('no heartbeat, runner self-attestation or forged scope fails closed', () => {
  assert.equal(checks(), false);
  for (const change of [
    {controllerRunId: 1001},
    {controllerIsRunner: true},
    {controllerKind: 'github-actions'},
    {kind: 'runner-heartbeat'},
    {mainSha: 'b'.repeat(40)},
    {previewDeploymentId: 'dpl_other'},
    {stagingProjectRef: 'fiepaguycecrredwrcwx'},
    {actorId: '22222222-2222-4222-8222-222222222222'},
    {approvalCommentId: 778},
    {runId: 1002},
    {novelId: 99},
    {episodeId: 12},
    {noPaidRetry: false}
  ]) assert.equal(checks({...receipt(), ...change}), false);
});
// prettier-ignore
test('expired, stale, future or overlong lease is rejected', () => {
  for (const change of [
    {observedAtMs: NOW - 15001},
    {heartbeatAtMs: NOW - 15001},
    {heartbeatAtMs: NOW + 1},
    {expiresAtMs: NOW},
    {expiresAtMs: NOW + 30001},
    {observedAtMs: NOW + 1}
  ]) assert.equal(checks({...receipt(), ...change}), false);
});
// prettier-ignore
test('external kill, disable, revocation, cleanup and census are all required', () => {
  for (const key of [
    'killAuthorityVerified', 'stagingDisableVerified',
    'sessionRevocationVerified', 'syntheticCleanupVerified',
    'zeroCensusVerified'
  ]) assert.equal(checks({...receipt(), [key]: false}), false);
});
// prettier-ignore
test('wrong Staging target or missing clock cannot arm anything', () => {
  assert.equal(checks(receipt(), {...scope, stagingProjectRef: 'fiepaguycecrredwrcwx'}), false);
  assert.equal(checks(receipt(), scope, NaN), false);
});
