import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

import { verifyGitHubActionsOidcToken } from './_lib/github-actions-oidc.js';
import { auditProductionBilling } from '../scripts/production-billing-audit-lib.mjs';
import {
  legacyWebhookFingerprint,
  repairCandidateFingerprint
} from '../scripts/production-approval-fingerprint.mjs';

const CANONICAL_SUPABASE_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
const CANONICAL_APP_URL = 'https://novelrise.vercel.app';
const EXPECTED_REPOSITORY = 'bingohooah888-ai/novelrise';
const EXPECTED_REF = 'refs/heads/main';
const EXPECTED_WORKFLOW_REF =
  'bingohooah888-ai/novelrise/.github/workflows/production-billing-guard.yml@refs/heads/main';
const OIDC_AUDIENCE = 'novelight-production-billing-guard';
const GUARD_VERSION = 'chat-approval-v1';
const LEGACY_WEBHOOK_ISSUE = 'legacy_novelight_webhook_endpoint';
const STALE_PAID_CUSTOMER_ISSUE = 'paid_profile_customer_missing_in_stripe';

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
  if (appUrl !== CANONICAL_APP_URL) {
    throw new Error('Refusing non-canonical Production app URL');
  }

  return { appUrl };
}

export function summarizeAudit(result) {
  const repairCandidates = result.issues.filter(
    (item) => item.code === STALE_PAID_CUSTOMER_ISSUE
  );
  const exactlyOneRepairCandidate = repairCandidates.length === 1;
  const legacyEndpoints = result.issues.filter(
    (item) => item.code === LEGACY_WEBHOOK_ISSUE
  );
  const cleanupRequired = legacyEndpoints.length > 0;

  const blockingIssues = result.issues.filter((item) => {
    if (item.code === LEGACY_WEBHOOK_ISSUE) return false;
    if (item.code === STALE_PAID_CUSTOMER_ISSUE) {
      return !exactlyOneRepairCandidate;
    }
    return true;
  });

  return {
    guardVersion: GUARD_VERSION,
    healthy: result.ok,
    repairRequired: exactlyOneRepairCandidate,
    repairCandidateCount: repairCandidates.length,
    repairFingerprint: exactlyOneRepairCandidate
      ? repairCandidateFingerprint(repairCandidates[0])
      : null,
    cleanupRequired,
    cleanupEndpointCount: legacyEndpoints.length,
    cleanupFingerprint: cleanupRequired
      ? legacyWebhookFingerprint(
          legacyEndpoints.map((item) => item.endpointId).filter(Boolean)
        )
      : null,
    blockingIssueCount: blockingIssues.length,
    warningCount: result.warnings.length,
    issueCodes: [...new Set(result.issues.map((item) => item.code))].sort(),
    warningCodes: [...new Set(result.warnings.map((item) => item.code))].sort()
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await verifyGitHubActionsOidcToken(bearerToken(req), {
      audience: OIDC_AUDIENCE,
      repository: EXPECTED_REPOSITORY,
      ref: EXPECTED_REF,
      workflowRef: EXPECTED_WORKFLOW_REF
    });
  } catch (error) {
    console.warn('Production billing guard authentication rejected', {
      name: error?.name || 'Error',
      message: error?.message || 'unknown'
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const config = requireProductionEnvironment(process.env);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const result = await auditProductionBilling({
      supabase,
      stripe,
      canonicalWebhookUrl: `${config.appUrl}/api/stripe-webhook`
    });

    return res.status(200).json(summarizeAudit(result));
  } catch (error) {
    console.error('Production billing guard audit failed', {
      name: error?.name || 'Error',
      type: error?.type || null,
      code: error?.code || null
    });
    return res.status(500).json({ error: 'Billing audit failed' });
  }
}
