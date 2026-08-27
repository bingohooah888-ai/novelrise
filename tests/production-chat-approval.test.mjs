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

test('billing guard creates requests and re-audits owner approval runs', async () => {
  const workflow = await text('.github/workflows/production-billing-guard.yml');

  assert.match(workflow, /NOVELIGHT_PRODUCTION_REQUEST/);
  assert.match(workflow, /date -u -d '\+30 minutes'/);
  assert.match(workflow, /repair_fingerprint/);
  assert.match(workflow, /cleanup_fingerprint/);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /NOVELIGHT Chat-Mediated Production Approval/);
  assert.match(workflow, /workflow_run\.actor\.login == 'bingohooah888-ai'/);
  assert.doesNotMatch(workflow, /environment: production-approval/);
});

test('chat approval is one-time, scope-bound, and secretless', async () => {
  const workflow = await text('.github/workflows/production-chat-approval.yml');

  assert.match(workflow, /issue_comment:/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /author_association == 'OWNER'/);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_APPROVE/);
  assert.match(workflow, /Production approval request expired/);
  assert.match(workflow, /main changed after the user approved this scope/);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_CLAIMED/);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_CONSUMED/);
  assert.match(workflow, /novelight-production-chat-approval/);
  assert.match(workflow, /production-billing-remediate/);
  assert.match(workflow, /EXPECTED_REMEDIATION_VERSION/);
  assert.doesNotMatch(workflow, /environment: production-approval/);
  assert.doesNotMatch(workflow, /STRIPE_LIVE_SECRET_KEY/);
  assert.doesNotMatch(workflow, /SUPABASE_SECRET_KEY/);
});

test('Production remediation endpoint re-verifies OIDC, scope, proof, and final audit', async () => {
  const source = await text('api/production-billing-remediate.js');

  assert.match(source, /verifyGitHubActionsOidcToken/);
  assert.match(source, /production-chat-approval\.yml@refs\/heads\/main/);
  assert.match(source, /claims\.sha !== scope\.mainSha/);
  assert.match(source, /claims\.actor !== 'bingohooah888-ai'/);
  assert.match(source, /repairCandidateFingerprint/);
  assert.match(source, /legacyWebhookFingerprint/);
  assert.match(source, /repairMissingProductionCustomer/);
  assert.match(source, /trial_period_days: 1/);
  assert.match(source, /verifyNoCharge/);
  assert.match(source, /auditProductionBilling/);
  assert.match(source, /finalIssueCount/);
});
