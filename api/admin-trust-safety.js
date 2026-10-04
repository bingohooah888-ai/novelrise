import { createClient } from '@supabase/supabase-js';
import { createAdminTrustSafetyHandler } from './_lib/admin-trust-safety.js';

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

export default createAdminTrustSafetyHandler({
  supabase,
  env: process.env
});
