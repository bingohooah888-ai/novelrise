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
const OIDC_AUDIENCE = 'novelight-production-chat-remediation';
const STALE_PAID_CUSTOMER_ISSUE = 'paid_profile_customer_missing_in_stripe';
const LEGACY_WEBHOOK_ISSUE = 'legacy_novelight_webhook_endpoint';
const ALLOWED_REMEDIATION_ISSUES = new Set([
  STALE_PAID_CUSTOMER_ISSUE,
  LEGACY_WEBHOOK_ISSUE
]);

function bearerToken(req) {
  const header = String(req.headers?.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] || null;
}

function requireProductionEnvironment(env) {
  const appUrl = String(env.NOVELIGHT_APP_URL || '').replace(/\/+$/, '');
  if (env.SUPABASE_URL !== CANONICAL_SUPABASE_URL) {
    throw new Error('Refusing non-canonical Production Supabase URL');
  }
  if (!env.SUPABASE_SECRET_KEY) {
    throw new Error('SUPABASE_SECRET_KEY is required');
  }
  if (!env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
    throw new Error('STRIPE_SECRET_KEY must be a live key');
  }
  if (!env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required');
  }
  if (appUrl !== CANONICAL_APP_URL) {
    throw new Error('Refusing non-canonical Production app URL');
  }
  return { appUrl };
}

function requireRequestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid remediation request');
  }
  const keys = Object.keys(body).sort();
  const expected = [
    'cleanupFingerprint',
    'cleanupRequired',
    'mainSha',
    'repairFingerprint',
    'repairRequired',
    'requestId'
  ].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error('Unexpected remediation request fields');
  }
  if (!/^billing-[0-9a-f]{40}-[0-9]+-[0-9]+$/.test(body.requestId || '')) {
    throw new Error('Invalid requestId');
  }
  if (!/^[0-9a-f]{40}$/.test(body.mainSha || '')) {
    throw new Error('Invalid mainSha');
  }
  if (
    typeof body.repairRequired !== 'boolean' ||
    typeof body.cleanupRequired !== 'boolean'
  ) {
    throw new Error('Invalid remediation scope flags');
  }
  if (
    body.repairRequired &&
    !/^sha256:[0-9a-f]{64}$/.test(body.repairFingerprint || '')
  ) {
    throw new Error('Invalid repair fingerprint');
  }
  if (!body.repairRequired && body.repairFingerprint !== null) {
    throw new Error('Unexpected repair fingerprint');
  }
  if (
    body.cleanupRequired &&
    !/^sha256:[0-9a-f]{64}$/.test(body.cleanupFingerprint || '')
  ) {
    throw new Error('Invalid cleanup fingerprint');
  }
  if (!body.cleanupRequired && body.cleanupFingerprint !== null) {
    throw new Error('Unexpected cleanup fingerprint');
  }
  if (!body.repairRequired && !body.cleanupRequired) {
    throw new Error('Request contains no Production mutation');
  }
  return body;
}

async function proveWebhook({ appUrl, webhookSecret }) {
  const stripe = new Stripe('sk_test_no_network_use');
  const payload = JSON.stringify({
    id: `evt_novelight_no_charge_${Date.now()}`,
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'novelight.no_charge_proof'
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret
  });
  const response = await fetch(`${appUrl}/api/stripe-webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature
    },
    body: payload
  });
  if (!response.ok) {
    throw new Error(`No-charge webhook proof failed with HTTP ${response.status}`);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = requireRequestBody(req.body);
    await verifyGitHubActionsOidcToken(bearerToken(req), {
      audience: OIDC_AUDIENCE,
      repository: EXPECTED_REPOSITORY,
      ref: EXPECTED_REF,
      workflowRef: EXPECTED_WORKFLOW_REF
    });
  } catch (error) {
    console.warn('Production remediation authorization rejected', {
      message: error?.message || 'unknown'
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { appUrl } = requireProductionEnvironment(process.env);
    if (process.env.VERCEL_GIT_COMMIT_SHA !== body.mainSha) {
      throw new Error('Production deployment SHA does not match approved main SHA');
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const webhookUrl = `${appUrl}/api/stripe-webhook`;

    const audit = await auditProductionBilling({
      supabase,
      stripe,
      canonicalWebhookUrl: webhookUrl
    });
    const unsupported = audit.issues.filter(
      (item) => !ALLOWED_REMEDIATION_ISSUES.has(item.code)
    );
    if (unsupported.length) {
      throw new Error('Unsupported Production billing drift is present');
    }

    const repairCandidates = audit.issues.filter(
      (item) => item.code === STALE_PAID_CUSTOMER_ISSUE
    );
    if (body.repairRequired) {
      if (repairCandidates.length !== 1) {
        throw new Error(
          `Expected exactly 1 approved repair candidate, found ${repairCandidates.length}`
        );
      }
      if (
        repairCandidateFingerprint(repairCandidates[0]) !==
        body.repairFingerprint
      ) {
        throw new Error('Production repair target changed after approval');
      }
      if (!repairCandidates[0].displayName) {
        throw new Error('Approved repair candidate has no display name');
      }
      await repairMissingProductionCustomer({
        supabase,
        stripe,
        targetDisplayName: repairCandidates[0].displayName
      });
    } else if (repairCandidates.length) {
      throw new Error('Unapproved billing repair candidate is present');
    }

    const current = await inspectWebhookEndpoint({
      stripe,
      webhookUrl,
      hasExistingWebhookSecret: true,
      rotateWebhookSecret: false
    });
    if (!current?.id) {
      throw new Error('Canonical Production webhook endpoint is missing');
    }
    const legacy = await findLegacyWebhookEndpoints({ stripe, webhookUrl });
    if (body.cleanupRequired) {
      if (
        legacyWebhookFingerprint(legacy.map((item) => item.id)) !==
        body.cleanupFingerprint
      ) {
        throw new Error('Production webhook cleanup target changed after approval');
      }
      await removeVerifiedLegacyWebhookEndpoints({
        stripe,
        webhookUrl,
        legacyEndpointIds: legacy.map((item) => item.id),
        currentEndpointId: current.id
      });
    } else if (legacy.length) {
      throw new Error('Unapproved legacy webhook cleanup is required');
    }

    await proveWebhook({
      appUrl,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
    });

    const finalAudit = await auditProductionBilling({
      supabase,
      stripe,
      canonicalWebhookUrl: webhookUrl
    });
    if (!finalAudit.ok) {
      throw new Error('Final Production billing audit is not healthy');
    }

    return res.status(200).json({
      ok: true,
      requestId: body.requestId,
      repairApplied: body.repairRequired,
      cleanupApplied: body.cleanupRequired,
      noChargeWebhookProof: true,
      finalAuditHealthy: true
    });
  } catch (error) {
    console.error('Production remediation failed', {
      requestId: body?.requestId || null,
      message: error?.message || 'unknown'
    });
    return res.status(409).json({ error: 'Production remediation failed' });
  }
}
