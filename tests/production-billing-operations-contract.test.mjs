import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Production billing health supports approved manual audit and gated scheduled audit', async () => {
  const workflow = await text(
    '.github/workflows/production-billing-health.yml'
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /production-approval/);
  assert.match(workflow, /production-observability/);
  assert.match(workflow, /PRODUCTION_BILLING_AUDIT_READY/);
  assert.match(workflow, /production-billing-audit\.mjs/);
});

test('legacy webhook cleanup remains approval-gated and proves the canonical no-charge path', async () => {
  const workflow = await text(
    '.github/workflows/production-webhook-legacy-cleanup.yml'
  );

  assert.match(workflow, /environment: production-approval/);
  assert.match(workflow, /production-webhook-legacy-cleanup\.mjs/);
  assert.match(workflow, /production-webhook-control\.mjs/);
  assert.match(workflow, /production-billing-audit\.mjs/);
  assert.doesNotMatch(workflow, /rotate_webhook_secret/);
});

test('Production control proof includes the real checkout API without a live payment', async () => {
  const script = await text('scripts/production-webhook-control.mjs');

  assert.match(script, /\/api\/create-checkout-session/);
  assert.match(script, /cs_live_/);
  assert.match(script, /checkout\.sessions\.expire/);
  assert.match(script, /payment_status === 'paid'/);
  assert.match(script, /trial_period_days: 1/);
  assert.match(script, /charges\.list/);
});

test('incident runbook makes evidence-first diagnosis and automation escalation explicit', async () => {
  const runbook = await text('docs/PRODUCTION-BILLING-INCIDENT-RUNBOOK.md');

  assert.match(runbook, /証拠を取る前にコードを直さない/);
  assert.match(runbook, /Client \/ Network evidence/);
  assert.match(runbook, /Application runtime evidence/);
  assert.match(runbook, /External provider evidence/);
  assert.match(runbook, /Database state evidence/);
  assert.match(runbook, /同種の手動操作が\*\*2回目\*\*/);
  assert.match(runbook, /Production Billing Health/);
});
