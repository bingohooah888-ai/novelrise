import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

import { repairMissingProductionCustomer } from './production-billing-repair-lib.mjs';

const CANONICAL_PRODUCTION_SUPABASE_URL =
  'https://fiepaguycecrredwrcwx.supabase.co';

function requireProductionEnvironment(env) {
  const targetDisplayName = env.TARGET_DISPLAY_NAME?.trim();
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseSecretKey = env.SUPABASE_SECRET_KEY;
  const stripeLiveSecretKey = env.STRIPE_LIVE_SECRET_KEY;

  if (!targetDisplayName) {
    throw new Error('TARGET_DISPLAY_NAME is required');
  }

  if (supabaseUrl !== CANONICAL_PRODUCTION_SUPABASE_URL) {
    throw new Error('Refusing non-canonical Production Supabase URL');
  }

  if (!supabaseSecretKey) {
    throw new Error('SUPABASE_SECRET_KEY is required');
  }

  if (!stripeLiveSecretKey?.startsWith('sk_live_')) {
    throw new Error('STRIPE_LIVE_SECRET_KEY must be a live key');
  }

  return {
    targetDisplayName,
    supabaseUrl,
    supabaseSecretKey,
    stripeLiveSecretKey
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

await repairMissingProductionCustomer({
  supabase,
  stripe,
  targetDisplayName: config.targetDisplayName
});
