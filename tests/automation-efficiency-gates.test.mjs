import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  classifyHighRiskPaths,
  highRiskApprovalChallenge,
  highRiskApprovalCommentMatches
} from '../scripts/high-risk-approval-lib.mjs';

const read = (path) => readFile(path, 'utf8');

test('high-risk approval is head-bound and narrowly classified', () => {
  const sha = 'a'.repeat(40);
  const challenge = highRiskApprovalChallenge(170, sha);
  assert.match(challenge, /^[A-F0-9]{8}$/);
  assert.deepEqual(
    classifyHighRiskPaths([
      'README.md',
      'api/create-checkout-session.js',
      '.github/workflows/production-billing-guard.yml',
      'tests/safe.test.mjs'
    ]),
    [
      '.github/workflows/production-billing-guard.yml',
      'api/create-checkout-session.js'
    ]
  );
  assert.equal(
    highRiskApprovalCommentMatches(
      `NOVELIGHT_HIGH_RISK_APPROVE ${JSON.stringify({
        operation: 'merge-high-risk-pr',
        pr: 170,
        headSha: sha,
        challenge
      })}`,
      { pr: 170, headSha: sha, challenge }
    ),
    true
  );
  assert.equal(
    highRiskApprovalCommentMatches(
      `NOVELIGHT_HIGH_RISK_APPROVE ${JSON.stringify({
        operation: 'merge-high-risk-pr',
        pr: 170,
        headSha: 'b'.repeat(40),
        challenge
      })}`,
      { pr: 170, headSha: sha, challenge }
    ),
    false
  );
});

test('Production billing guard avoids unrelated API pushes and uses dedicated approval issues', async () => {
  const guard = await read('.github/workflows/production-billing-guard.yml');
  assert.equal(guard.includes("- 'api/**'"), false);
  assert.match(guard, /api\/create-checkout-session\.js/);
  assert.match(guard, /api\/production-billing-remediate\.js/);
  assert.match(guard, /\[Production Approval\]/);
  assert.match(guard, /challenge/);
  assert.match(guard, /issues\?state=open&per_page=100/);
  assert.match(guard, /Reusing active scoped Production approval issue/);
});

test('Production approval is one-request-per-issue and challenge-bound', async () => {
  const approval = await read('.github/workflows/production-chat-approval.yml');
  assert.equal(approval.includes("LEDGER_ISSUE: '165'"), false);
  assert.equal(approval.includes('ledger-page-'), false);
  assert.match(
    approval,
    /github\.event\.issue\.user\.login == 'github-actions\[bot\]'/
  );
  assert.match(
    approval,
    /approval challenge does not match this one-time request/
  );
  assert.match(approval, /issues\/\$ISSUE_NUMBER\/comments\?per_page=100/);
  assert.match(approval, /Record consumed approval and close dedicated issue/);
});

test('failed Production billing guard runs create one actionable incident', async () => {
  const incident = await read(
    '.github/workflows/production-billing-incident.yml'
  );
  assert.match(incident, /workflow_run/);
  assert.match(incident, /NOVELIGHT Production Billing Guard/);
  assert.match(incident, /\[Production Incident\] Billing guard failed/);
  assert.match(incident, /Open or update incident on guard failure/);
  assert.match(incident, /Resolve prior incident after a healthy guard run/);
});

test('staging validation is consolidated into one deployment-status workflow', async () => {
  const staging = await read('.github/workflows/staging-smoke.yml');
  assert.match(staging, /name: NOVELIGHT Staging Smoke/);
  assert.match(staging, /Checkout deployed revision once/);
  assert.match(staging, /Install browser test dependencies once/);
  assert.match(staging, /Run read-only staging smoke/);
  assert.match(staging, /Run authenticated staging smoke/);
  assert.match(staging, /Run complete Stripe test billing smoke/);

  for (const legacy of [
    '.github/workflows/staging-readiness-smoke.yml',
    '.github/workflows/staging-authenticated-smoke.yml',
    '.github/workflows/staging-billing-smoke.yml'
  ]) {
    await assert.rejects(access(legacy));
  }
});

test('owner high-risk approval relay validates exact SHA then reruns failed CI', async () => {
  const workflow = await read('.github/workflows/high-risk-pr-approval.yml');
  const readiness = await read('scripts/check-merge-readiness.mjs');
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /NOVELIGHT_HIGH_RISK_APPROVE/);
  assert.match(workflow, /high-risk-approval-lib\.mjs challenge/);
  assert.match(workflow, /rerun-failed-jobs/);
  assert.match(readiness, /enforceHighRiskApproval/);
  assert.match(readiness, /author_association === 'OWNER'/);
  assert.match(readiness, /High-risk paths:/);
});

test('Production static verification requires stable all-route convergence', async () => {
  const verification = await read('scripts/verify-production-static.sh');
  const routeLoops = verification.match(/while IFS= read -r route; do/g) ?? [];
  const stableResets = verification.match(/stable_passes=0/g) ?? [];

  assert.equal(verification.includes('first_route='), false);
  assert.equal(routeLoops.length, 1);
  assert.ok(stableResets.length >= 2);
  assert.match(verification, /required_stable_passes=2/);
  assert.match(verification, /for attempt in \$\(seq 1 24\); do/);
  assert.match(verification, /all_routes_match=true/);
  assert.match(verification, /stable_passes=\$\(\(stable_passes \+ 1\)\)/);
  assert.match(
    verification,
    /\[ "\$stable_passes" -ge "\$required_stable_passes" \]/
  );
  assert.match(verification, /confirming stable convergence/);
});
