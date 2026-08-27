import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

import { auditProductionBilling } from './production-billing-audit-lib.mjs';
import { repairCandidateFingerprint } from './production-approval-fingerprint.mjs';
import { repairMissingProductionCustomer } from './production-billing-repair-lib.mjs';

const CANONICAL_PRODUCTION_SUPABASE_URL =
  'https://fiepaguycecrredwrcwx.supabase.co';
const CANONICAL_APP_URL = 'https://novelrise.vercel.app';
const STALE_PAID_CUSTOMER_ISSUE = 'paid_profile_customer_missing_in_stripe';
const LEGACY_WEBHOOK_ISSUE = 'legacy_novelight_webhook_endpoint';
const ALLOWED_REMEDIATION_ISSUES = new Set([
  STALE_PAID_CUSTOMER_ISSUE,
  LEGACY_WEBHOOK_ISSUE
]);

function requireProductionEnvironment(env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseSecretKey = env.SUPABASE_SECRET_KEY;
  const stripeLiveSecretKey = env.STRIPE_LIVE_SECRET_KEY;
  const appUrl = String(env.NOVELIGHT_APP_URL || '').replace(/\/+$/, '');

  if (supabaseUrl !== CANONICAL_PRODUCTION_SUPABASE_URL) {
    throw new Error('Refusing non-canonical Production Supabase URL');
  }
  if (!supabaseSecretKey) {
    throw new Error('SUPABASE_SECRET_KEY is required');
  }
  if (!stripeLiveSecretKey?.startsWith('sk_live_')) {
    throw new Error('STRIPE_LIVE_SECRET_KEY must be a live key');
  }
  if (appUrl !== CANONICAL_APP_URL) {
    throw new Error('Refusing non-canonical Production app URL');
  }

  return {
    supabaseUrl,
    supabaseSecretKey,
    stripeLiveSecretKey,
    appUrl,
    expectedRepairFingerprint: env.EXPECTED_REPAIR_FINGERPRINT || null
  };
}

const config = requireProductionEnvironment(process.env);
const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
const stripe = new Stripe(config.stripeLiveSecretKey);

const audit = await auditProductionBilling({
  supabase,
  stripe,
  canonicalWebhookUrl: `${config.appUrl}/api/stripe-webhook`
});

const unsupportedIssues = audit.issues.filter(
  (item) => !ALLOWED_REMEDIATION_ISSUES.has(item.code)
);
if (unsupportedIssues.length) {
  throw new Error(
    `Safety stop: unsupported Production billing drift is present: ${[
      ...new Set(unsupportedIssues.map((item) => item.code))
    ].join(', ')}`
  );
}

const repairCandidates = audit.issues.filter(
  (item) => item.code === STALE_PAID_CUSTOMER_ISSUE
);
if (repairCandidates.length > 1) {
  throw new Error(
    `Safety stop: expected at most 1 stale paid profile, found ${repairCandidates.length}`
  );
}

if (config.expectedRepairFingerprint) {
  if (repairCandidates.length !== 1) {
    throw new Error(
      `Safety stop: approved repair expected exactly 1 stale paid profile, found ${repairCandidates.length}`
    );
  }

  const actualFingerprint = repairCandidateFingerprint(repairCandidates[0]);
  if (actualFingerprint !== config.expectedRepairFingerprint) {
    throw new Error('Safety stop: Production repair target changed after approval');
  }
}

if (repairCandidates.length === 0) {
  console.log('No stale paid Stripe customer reference requires repair.');
} else {
  const candidate = repairCandidates[0];
  if (!candidate.displayName) {
    throw new Error('Safety stop: repair candidate has no display name');
  }

  console.log(
    'One stale paid Stripe customer reference was independently confirmed; running the approved fail-closed repair.'
  );

  await repairMissingProductionCustomer({
    supabase,
    stripe,
    targetDisplayName: candidate.displayName
  });
}
