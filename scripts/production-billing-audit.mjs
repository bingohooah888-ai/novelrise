import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

import { auditProductionBilling } from './production-billing-audit-lib.mjs';

const CANONICAL_PRODUCTION_SUPABASE_URL =
  'https://fiepaguycecrredwrcwx.supabase.co';
const CANONICAL_PRODUCTION_APP_URL = 'https://novelrise.vercel.app';

function requireEnvironment(env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseSecretKey = env.SUPABASE_SECRET_KEY;
  const stripeLiveSecretKey = env.STRIPE_LIVE_SECRET_KEY;
  const appUrl = (env.NOVELIGHT_APP_URL || '').replace(/\/+$/, '');

  if (supabaseUrl !== CANONICAL_PRODUCTION_SUPABASE_URL) {
    throw new Error('Refusing non-canonical Production Supabase URL');
  }
  if (!supabaseSecretKey) {
    throw new Error('SUPABASE_SECRET_KEY is required');
  }
  if (!stripeLiveSecretKey?.startsWith('sk_live_')) {
    throw new Error('STRIPE_LIVE_SECRET_KEY must be a live key');
  }
  if (appUrl !== CANONICAL_PRODUCTION_APP_URL) {
    throw new Error('Refusing non-canonical Production app URL');
  }

  return {
    supabaseUrl,
    supabaseSecretKey,
    stripeLiveSecretKey,
    appUrl
  };
}

function formatFinding(finding) {
  const target = finding.displayName
    ? ` display_name=${JSON.stringify(finding.displayName)}`
    : '';
  return `${finding.code}${target}`;
}

const config = requireEnvironment(process.env);
const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
const stripe = new Stripe(config.stripeLiveSecretKey);

const result = await auditProductionBilling({
  supabase,
  stripe,
  canonicalWebhookUrl: `${config.appUrl}/api/stripe-webhook`
});

console.log(
  `Production billing audit: ${result.summary.profileCount} profiles, ` +
    `${result.summary.issueCount} issues, ${result.summary.warningCount} warnings, ` +
    `${result.summary.legacyWebhookCount} active legacy webhook endpoints.`
);

for (const item of result.warnings) {
  console.warn(`WARN ${formatFinding(item)}`);
}
for (const item of result.issues) {
  console.error(`ISSUE ${formatFinding(item)}`);
}

if (!result.ok) {
  throw new Error(
    'Production billing audit found inconsistent state. Diagnose before billing changes or live checkout.'
  );
}

console.log('PASS: Production Stripe/Supabase/webhook billing state is consistent.');
