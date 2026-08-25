import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { createStagingBillingReconcileHandler } from './_lib/staging-billing-reconcile.js';

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

export default createStagingBillingReconcileHandler({
  stripe,
  supabase,
  env: process.env
});
