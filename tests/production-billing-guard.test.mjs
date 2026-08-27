import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeAudit } from '../api/production-billing-guard.js';

function result(issueCodes = [], warningCodes = []) {
  return {
    ok: issueCodes.length === 0,
    issues: issueCodes.map((code, index) => ({
      code,
      profileId: `p-${index}`
    })),
    warnings: warningCodes.map((code) => ({ code }))
  };
}

test('one missing paid Stripe customer is approval-repairable', () => {
  const summary = summarizeAudit(
    result(['paid_profile_customer_missing_in_stripe'])
  );

  assert.equal(summary.guardVersion, 'stale-paid-remediation-v1');
  assert.equal(summary.repairRequired, true);
  assert.equal(summary.repairCandidateCount, 1);
  assert.equal(summary.blockingIssueCount, 0);
});

test('multiple missing paid Stripe customers fail closed', () => {
  const summary = summarizeAudit(
    result([
      'paid_profile_customer_missing_in_stripe',
      'paid_profile_customer_missing_in_stripe'
    ])
  );

  assert.equal(summary.repairRequired, false);
  assert.equal(summary.repairCandidateCount, 2);
  assert.equal(summary.blockingIssueCount, 2);
});

test('legacy webhook cleanup can share the same Production approval', () => {
  const summary = summarizeAudit(
    result([
      'paid_profile_customer_missing_in_stripe',
      'legacy_novelight_webhook_endpoint'
    ])
  );

  assert.equal(summary.repairRequired, true);
  assert.equal(summary.cleanupRequired, true);
  assert.equal(summary.blockingIssueCount, 0);
});

test('unknown billing drift remains blocking', () => {
  const summary = summarizeAudit(
    result(['paid_profile_without_entitled_subscription'])
  );

  assert.equal(summary.repairRequired, false);
  assert.equal(summary.cleanupRequired, false);
  assert.equal(summary.blockingIssueCount, 1);
});
