import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import {
  legacyWebhookFingerprint,
  repairCandidateFingerprint
} from '../scripts/production-approval-fingerprint.mjs';

const root = new URL('../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('approval fingerprints are scoped hashes', () => {
  const repair = repairCandidateFingerprint({
    profileId: 'profile-secret-value',
    stripeCustomerId: 'cus_secret_value'
  });
  const cleanupA = legacyWebhookFingerprint(['we_b', 'we_a']);
  const cleanupB = legacyWebhookFingerprint(['we_a', 'we_b']);

  assert.match(repair, /^sha256:[0-9a-f]{64}$/);
  assert.doesNotMatch(repair, /profile-secret-value|cus_secret_value/);
  assert.equal(cleanupA, cleanupB);
});

test('billing guard creates a scoped approval request', async () => {
  const workflow = await text('.github/workflows/production-billing-guard.yml');

  assert.match(workflow, /issues: write/);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_REQUEST/);
  assert.match(workflow, /issues\/\$LEDGER_ISSUE\/comments/);
  assert.match(workflow, /date -u -d '\+30 minutes'/);
  assert.match(workflow, /repair_fingerprint/);
  assert.match(workflow, /cleanup_fingerprint/);
  assert.doesNotMatch(workflow, /environment: production-approval/);
  assert.doesNotMatch(workflow, /production-billing-auto-remediate\.mjs/);
});

test('chat approval is one-time and scope-bound', async () => {
  const workflow = await text('.github/workflows/production-chat-approval.yml');

  assert.match(workflow, /issue_comment:/);
  assert.match(workflow, /github\.event\.issue\.number == 165/);
  assert.match(workflow, /github\.event\.comment\.user\.login/);
  assert.match(workflow, /author_association == 'OWNER'/);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_APPROVE/);
  assert.match(workflow, /Production approval request expired/);
  assert.match(workflow, /main changed after the user approved this scope/);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_CLAIMED/);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_CONSUMED/);
  assert.match(workflow, /EXPECTED_REPAIR_FINGERPRINT/);
  assert.match(workflow, /EXPECTED_LEGACY_WEBHOOK_FINGERPRINT/);
  assert.match(workflow, /production-webhook-control\.mjs/);
  assert.match(workflow, /production-billing-audit\.mjs/);
  assert.doesNotMatch(workflow, /environment: production-approval/);
});
