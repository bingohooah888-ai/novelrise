import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

import { verifyGitHubActionsOidcToken } from './_lib/github-actions-oidc.js';
import { auditProductionBilling } from '../scripts/production-billing-audit-lib.mjs';
import {
  legacyWebhookFingerprint,
  repairCandidateFingerprint
} from '../scripts/production-approval-fingerprint.mjs';
import { repairMissingProductionCustomer } from '../scripts/production-billing-repair-lib.mjs';
import {
  findLegacyWebhookEndpoints,
  inspectWebhookEndpoint,
  removeVerifiedLegacyWebhookEndpoints
} from '../scripts/stripe-production-webhook-endpoint.mjs';

const CANONICAL_SUPABASE_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
const CANONICAL_APP_URL = 'https://novelrise.vercel.app';
const EXPECTED_REPOSITORY = 'bingohooah888-ai/novelrise';
const EXPECTED_REF = 'refs/heads/main';
const EXPECTED_WORKFLOW_REF =
  'bingohooah888-ai/novelrise/.github/workflows/production-chat-approval.yml@refs/heads/main';
const OIDC_AUDIENCE = 'novelight-production-chat-approval';
const REMEDIATION_VERSION = 'chat-approval-oidc-v1';
const STALE_PAID_CUSTOMER_ISSUE = 'paid_profile_customer_missing_in_stripe';
const LEGACY_WEBHOOK_ISSUE = 'legacy_novelight_webhook_endpoint';
const ALLOWED_ISSUES = new Set([
  STALE_PAID_CUSTOMER_ISSUE,
  LEGACY_WEBHOOK_ISSUE
]);

export const maxDuration = 300;

function fail(message) {
  throw new Error(message);
}

function bearerToken(req) {
  const header = String(req.headers?.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] || null;
}

function requireProductionEnvironment(env) {
  const appUrl = String(env.NOVELIGHT_APP_URL || '').replace(/\/+$/, '');

  if (env.SUPABASE_URL !== CANONICAL_SUPABASE_URL) {
    fail('Refusing non-canonical Production Supabase URL');
  }
  if (!env.SUPABASE_SECRET_KEY) fail('SUPABASE_SECRET_KEY is required');
  if (!env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
    fail('STRIPE_SECRET_KEY must be a live key');
  }
  if (!env.STRIPE_STANDARD_PRICE_ID?.startsWith('price_')) {
    fail('STRIPE_STANDARD_PRICE_ID is required');
  }
  if (appUrl !== CANONICAL_APP_URL) {
    fail('Refusing non-canonical Production app URL');
  }

  return {
    appUrl,
    standardPriceId: env.STRIPE_STANDARD_PRICE_ID
  };
}

function validateScope(body) {
  const keys = Object.keys(body || {}).sort();
  const expected = [
    'cleanupFingerprint',
    'cleanupRequired',
    'mainSha',
    'operation',
    'repairFingerprint',
    'repairRequired',
    'requestId'
  ].sort();

  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    fail('Invalid Production remediation scope');
  }
  if (body.operation !== 'production-billing-remediation') {
    fail('Invalid Production remediation operation');
  }
  if (!/^billing-[0-9a-f]{40}-[0-9]+-[0-9]+$/.test(body.requestId)) {
    fail('Invalid Production remediation request ID');
  }
  if (!/^[0-9a-f]{40}$/.test(body.mainSha)) {
    fail('Invalid Production remediation main SHA');
  }
  if (typeof body.repairRequired !== 'boolean') {
    fail('Invalid repairRequired value');
  }
  if (typeof body.cleanupRequired !== 'boolean') {
    fail('Invalid cleanupRequired value');
  }
  if (
    body.repairRequired &&
    !/^sha256:[0-9a-f]{64}$/.test(body.repairFingerprint || '')
  ) {
    fail('Invalid approved repair fingerprint');
  }
  if (
    body.cleanupRequired &&
    !/^sha256:[0-9a-f]{64}$/.test(body.cleanupFingerprint || '')
  ) {
    fail('Invalid approved cleanup fingerprint');
  }
  if (!body.repairRequired && body.repairFingerprint !== null) {
    fail('Unexpected repair fingerprint');
  }
  if (!body.cleanupRequired && body.cleanupFingerprint !== null) {
    fail('Unexpected cleanup fingerprint');
  }
  if (!body.repairRequired && !body.cleanupRequired) {
    fail('Production remediation scope contains no mutation');
  }

  return body;
}

function assertNoError(result, label) {
  if (result?.error) fail(`${label}: ${result.error.message}`);
  return result?.data;
}

async function waitFor(label, probe, { attempts = 24, delayMs = 2500 } = {}) {
  let lastValue = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const observation = await probe();
    lastValue = observation?.value ?? null;
    if (observation?.ok) return lastValue;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  fail(`${label} did not converge`);
}

async function proveExternalWebhookWithoutCharge({
  supabase,
  stripe,
  standardPriceId,
  requestId
}) {
  const suffix = randomBytes(5).toString('hex');
  const fixture = {
    userId: null,
    customerId: null,
    subscriptionId: null,
    email: `novelight-remediation-${suffix}@example.com`,
    password: `Nl!${randomBytes(24).toString('base64url')}9a`
  };
  let mainError = null;

  async function verifyNoCharge() {
    if (!fixture.customerId) return;
    const charges = await stripe.charges.list({
      customer: fixture.customerId,
      limit: 10
    });
    if (
      (charges.data || []).some(
        (charge) => charge.amount > 0 || charge.amount_captured > 0
      )
    ) {
      fail('No-charge proof unexpectedly created a live Stripe charge');
    }

    const invoices = await stripe.invoices.list({
      customer: fixture.customerId,
      limit: 10
    });
    if ((invoices.data || []).some((invoice) => (invoice.amount_paid || 0) > 0)) {
      fail('No-charge proof unexpectedly paid a live Stripe invoice');
    }
  }

  async function cleanup() {
    const errors = [];

    if (fixture.subscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          fixture.subscriptionId
        );
        if (subscription.status !== 'canceled') {
          await stripe.subscriptions.cancel(fixture.subscriptionId, {
            invoice_now: false,
            prorate: false
          });
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } catch (error) {
        if (error?.code !== 'resource_missing') {
          errors.push(`cancel proof subscription: ${error.message}`);
        }
      }
    }

    if (fixture.customerId) {
      try {
        await stripe.customers.del(fixture.customerId);
      } catch (error) {
        if (error?.code !== 'resource_missing') {
          errors.push(`delete proof customer: ${error.message}`);
        }
      }
    }

    if (fixture.userId) {
      try {
        assertNoError(
          await supabase
            .from('subscription_event_log')
            .delete()
            .eq('user_id', fixture.userId),
          'cleanup proof subscription_event_log'
        );
        assertNoError(
          await supabase
            .from('founding_author_exclusion_audit')
            .delete()
            .eq('author_id', fixture.userId),
          'cleanup proof founding_author_exclusion_audit'
        );
        assertNoError(
          await supabase
            .from('founding_author_exclusions')
            .delete()
            .eq('user_id', fixture.userId),
          'cleanup proof founding_author_exclusions'
        );
        assertNoError(
          await supabase.from('profiles').delete().eq('id', fixture.userId),
          'cleanup proof profile'
        );
        const deleted = await supabase.auth.admin.deleteUser(fixture.userId);
        if (deleted.error && !/not found/i.test(deleted.error.message || '')) {
          throw deleted.error;
        }
      } catch (error) {
        errors.push(`delete proof user: ${error.message}`);
      }
    }

    if (errors.length) fail(errors.join('; '));
  }

  try {
    const created = assertNoError(
      await supabase.auth.admin.createUser({
        email: fixture.email,
        password: fixture.password,
        email_confirm: true,
        user_metadata: {
          display_name: `NOVELIGHT Billing Remediation Proof ${suffix}`,
          internal_e2e: true,
          production_billing_remediation_proof: true
        }
      }),
      'create Production remediation proof user'
    );
    fixture.userId = created.user.id;

    await waitFor('Production remediation proof profile creation', async () => {
      const result = await supabase
        .from('profiles')
        .select('id')
        .eq('id', fixture.userId)
        .maybeSingle();
      assertNoError(result, 'read Production remediation proof profile');
      return { ok: Boolean(result.data?.id), value: result.data ?? null };
    });

    assertNoError(
      await supabase.from('founding_author_exclusions').upsert(
        {
          user_id: fixture.userId,
          reason: `automated billing remediation proof ${requestId}`
        },
        { onConflict: 'user_id' }
      ),
      'exclude Production remediation proof user from Founding Authors'
    );

    const customer = await stripe.customers.create({
      email: fixture.email,
      metadata: {
        userId: fixture.userId,
        novelightRemediationProof: 'true',
        requestId
      }
    });
    fixture.customerId = customer.id;

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: standardPriceId }],
      trial_period_days: 1,
      trial_settings: {
        end_behavior: { missing_payment_method: 'cancel' }
      },
      metadata: {
        userId: fixture.userId,
        novelightRemediationProof: 'true',
        requestId
      }
    });
    fixture.subscriptionId = subscription.id;
    if (subscription.status !== 'trialing') {
      fail(`Expected trialing proof subscription, got ${subscription.status}`);
    }

    await waitFor('Stripe -> Production entitlement proof', async () => {
      const result = await supabase
        .from('profiles')
        .select(
          'plan,payment_status,stripe_customer_id,stripe_subscription_id,subscription_status'
        )
        .eq('id', fixture.userId)
        .maybeSingle();
      assertNoError(result, 'read Production remediation proof entitlement');
      const row = result.data ?? null;
      return {
        ok:
          row?.plan === 'standard' &&
          row?.payment_status === 'active' &&
          row?.stripe_customer_id === fixture.customerId &&
          row?.stripe_subscription_id === fixture.subscriptionId &&
          row?.subscription_status === 'trialing',
        value: row
      };
    });

    await verifyNoCharge();
    await stripe.subscriptions.cancel(fixture.subscriptionId, {
      invoice_now: false,
      prorate: false
    });

    await waitFor('Stripe -> Production cancellation proof', async () => {
      const result = await supabase
        .from('profiles')
        .select('plan,payment_status,subscription_status')
        .eq('id', fixture.userId)
        .maybeSingle();
      assertNoError(result, 'read Production remediation proof cancellation');
      const row = result.data ?? null;
      return {
        ok:
          row?.plan === 'free' &&
          row?.payment_status === 'canceled' &&
          row?.subscription_status === 'canceled',
        value: row
      };
    });

    await verifyNoCharge();
  } catch (error) {
    mainError = error;
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      if (!mainError) mainError = cleanupError;
    }
  }

  if (mainError) throw mainError;
  return true;
}

async function remediateApprovedScope({ supabase, stripe, appUrl, scope }) {
  const audit = await auditProductionBilling({
    supabase,
    stripe,
    canonicalWebhookUrl: `${appUrl}/api/stripe-webhook`
  });
  const unsupported = audit.issues.filter(
    (item) => !ALLOWED_ISSUES.has(item.code)
  );
  if (unsupported.length) {
    fail(
      `Safety stop: unsupported Production billing drift: ${[
        ...new Set(unsupported.map((item) => item.code))
      ].join(', ')}`
    );
  }

  const repairCandidates = audit.issues.filter(
    (item) => item.code === STALE_PAID_CUSTOMER_ISSUE
  );
  if (scope.repairRequired) {
    if (repairCandidates.length !== 1) {
      fail('Safety stop: approved repair scope no longer contains exactly one target');
    }
    if (
      repairCandidateFingerprint(repairCandidates[0]) !== scope.repairFingerprint
    ) {
      fail('Safety stop: Production repair target changed after approval');
    }
  } else if (repairCandidates.length !== 0) {
    fail('Safety stop: unapproved stale paid profile appeared after approval');
  }

  const legacy = await findLegacyWebhookEndpoints({
    stripe,
    webhookUrl: `${appUrl}/api/stripe-webhook`
  });
  if (scope.cleanupRequired) {
    if (
      legacyWebhookFingerprint(legacy.map((endpoint) => endpoint.id)) !==
      scope.cleanupFingerprint
    ) {
      fail('Safety stop: Production webhook cleanup scope changed after approval');
    }
  } else if (legacy.length !== 0) {
    fail('Safety stop: unapproved legacy webhook scope appeared after approval');
  }

  if (scope.repairRequired) {
    const candidate = repairCandidates[0];
    if (!candidate.displayName) fail('Safety stop: repair target has no display name');
    await repairMissingProductionCustomer({
      supabase,
      stripe,
      targetDisplayName: candidate.displayName
    });
  }

  let removedWebhookCount = 0;
  if (scope.cleanupRequired) {
    const webhookUrl = `${appUrl}/api/stripe-webhook`;
    const current = await inspectWebhookEndpoint({
      stripe,
      webhookUrl,
      hasExistingWebhookSecret: true,
      rotateWebhookSecret: false
    });
    if (!current?.id) fail('Canonical Production Stripe webhook endpoint is missing');

    const removed = await removeVerifiedLegacyWebhookEndpoints({
      stripe,
      webhookUrl,
      legacyEndpointIds: legacy.map((endpoint) => endpoint.id),
      currentEndpointId: current.id
    });
    if (removed.length !== legacy.length) {
      fail('Legacy webhook cleanup count did not match approved scope');
    }
    removedWebhookCount = removed.length;
  }

  return { removedWebhookCount };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ remediationVersion: REMEDIATION_VERSION });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let claims;
  try {
    claims = await verifyGitHubActionsOidcToken(bearerToken(req), {
      audience: OIDC_AUDIENCE,
      repository: EXPECTED_REPOSITORY,
      ref: EXPECTED_REF,
      workflowRef: EXPECTED_WORKFLOW_REF
    });
  } catch (error) {
    console.warn('Production billing remediation authentication rejected', {
      message: error?.message || 'unknown'
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const scope = validateScope(req.body || {});
    if (claims.sha !== scope.mainSha) {
      fail('GitHub OIDC SHA does not match approved main SHA');
    }
    if (claims.event_name !== 'issue_comment') {
      fail('GitHub OIDC event is not an issue_comment approval');
    }
    if (claims.actor !== 'bingohooah888-ai') {
      fail('GitHub OIDC actor is not the repository owner');
    }

    const config = requireProductionEnvironment(process.env);
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const remediation = await remediateApprovedScope({
      supabase,
      stripe,
      appUrl: config.appUrl,
      scope
    });

    await proveExternalWebhookWithoutCharge({
      supabase,
      stripe,
      standardPriceId: config.standardPriceId,
      requestId: scope.requestId
    });

    const finalAudit = await auditProductionBilling({
      supabase,
      stripe,
      canonicalWebhookUrl: `${config.appUrl}/api/stripe-webhook`
    });
    if (!finalAudit.ok) {
      fail(
        `Final Production billing audit failed: ${[
          ...new Set(finalAudit.issues.map((item) => item.code))
        ].join(', ')}`
      );
    }

    return res.status(200).json({
      remediationVersion: REMEDIATION_VERSION,
      ok: true,
      repaired: scope.repairRequired,
      removedWebhookCount: remediation.removedWebhookCount,
      noChargeWebhookProof: true,
      finalIssueCount: finalAudit.summary.issueCount,
      finalWarningCount: finalAudit.summary.warningCount
    });
  } catch (error) {
    console.error('Production billing remediation failed', {
      name: error?.name || 'Error',
      type: error?.type || null,
      code: error?.code || null,
      message: error?.message || 'unknown'
    });
    return res.status(409).json({
      remediationVersion: REMEDIATION_VERSION,
      error: 'Production billing remediation failed safely'
    });
  }
}
