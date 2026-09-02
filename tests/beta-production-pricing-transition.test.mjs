import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Production Stripe bootstrap fixes beta Premium at 480 JPY and keeps Standard 980 as legacy-only reference', async () => {
  const [bootstrap, runbook] = await Promise.all([
    read('scripts/stripe-production-bootstrap.mjs'),
    read('docs/STRIPE-PRODUCTION-BOOTSTRAP.md')
  ]);

  assert.match(bootstrap, /key: 'standard'[\s\S]*amount: 980/u);
  assert.match(bootstrap, /key: 'premium'[\s\S]*amount: 480/u);
  assert.match(bootstrap, /novelight_premium_beta_2026_monthly_jpy/u);
  assert.match(bootstrap, /unit_amount !== 1980/u);
  assert.match(runbook, /Standard.*0円.*カード登録不要/u);
  assert.match(runbook, /Premium.*480円/u);
  assert.match(runbook, /新規Standard Checkoutには使用しない/u);
});

test('Production subscription transition stops recurring Standard 980 without a new charge and migrates Premium without proration', async () => {
  const transition = await read(
    'scripts/stripe-production-beta-pricing-transition.mjs'
  );

  assert.match(transition, /stripe\.subscriptions\.cancel\(subscription\.id,[\s\S]*invoice_now: false,[\s\S]*prorate: false/u);
  assert.match(transition, /stripe\.subscriptions\.update\(subscription\.id,[\s\S]*price: premiumPriceId/u);
  assert.match(transition, /proration_behavior: 'none'/u);
  assert.match(transition, /novelightBetaPrice: '480'/u);
});

test('Production workflow deploys beta-aware runtime before mutating legacy subscriptions', async () => {
  const workflow = await read('.github/workflows/stripe-production-bootstrap.yml');
  const deployIndex = workflow.indexOf('Deploy Production with synchronized billing configuration');
  const transitionIndex = workflow.indexOf('Transition existing subscriptions to beta pricing');

  assert.notEqual(deployIndex, -1);
  assert.notEqual(transitionIndex, -1);
  assert.ok(deployIndex < transitionIndex);
  assert.match(workflow, /NOVELIGHT_BETA_STANDARD_FREE/u);
  assert.match(workflow, /production-beta-billing-control\.mjs/u);
});

test('beta Standard migration has a fail-closed rollback artifact', async () => {
  const rollback = await read(
    'supabase/rollback/20260902143000_beta_standard_free_entitlement_rollback.sql'
  );

  assert.match(rollback, /payment_status = 'beta_free'/u);
  assert.match(rollback, /beta_standard_rollback_requires_profile_reconciliation/u);
  assert.match(rollback, /drop function if exists public\.novelight_activate_beta_standard/u);
  assert.match(rollback, /checkout_profile_not_free/u);
});
