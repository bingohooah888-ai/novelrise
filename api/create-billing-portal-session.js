import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { createBillingPortalHandler } from './_lib/billing-portal.js';

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

export default createBillingPortalHandler({
  stripe,
  supabase,
  env: process.env
});
