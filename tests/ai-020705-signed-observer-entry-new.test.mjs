// New OFFLINE-only entry gates. No live secrets or Staging requests.
import assert from 'node:assert/strict';
import test from 'node:test';
import { create020705SignedObserverBoundControllerEntryCandidate } from '../.github/staging-ai-02-07-05/gatea-controller-execution-entry-candidate.mjs';

// prettier-ignore
test('missing signed observer bindings fail closed before Staging stop', async () => {
  let touched = false;
  const entry = create020705SignedObserverBoundControllerEntryCandidate({
    makeStagingStopPorts: async () => {touched = true; return {};},
    verifyStagingPortAttestation: async () => true,
    inspectIndependentArm: async () => ({}),
    signWithControllerKey: async () => ''
  });
  const request = new globalThis.Request(
    'https://gatea-recovery.internal/_novelight/gatea/recover',
    {method: 'POST', headers: {'content-type':'application/json'},
      body: '{}'});
  const env = {
    GATEA_CONTROLLER_LIVE_ENABLED: 'true',
    GATEA_CONTROLLER_RECOVERY_ADMISSION_ENABLED: 'true'
  };
  assert.equal((await entry.fetch(request, env)).status, 404);
  assert.equal(touched, false);
  assert.equal((await entry.fetch(request, {})).status, 404);
  await assert.rejects(entry.issueArmReceipt({}, env),
    /CONTROLLER_ENTRY_NO_GO/u);
  await assert.rejects(entry.issueArmReceipt({}, {}),
    /CONTROLLER_ENTRY_NO_GO/u);
  assert.equal(touched, false);
});
// prettier-ignore
test('portless opt-in Controller cannot be created', () => {
  assert.throws(() =>
    create020705SignedObserverBoundControllerEntryCandidate(),
  /CONTROLLER_ENTRY_NO_GO/u);
});
