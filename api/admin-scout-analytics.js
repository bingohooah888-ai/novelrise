import { createClient } from '@supabase/supabase-js';
import { createAdminScoutAnalyticsHandler } from './_lib/admin-scout-analytics.js';

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

export default createAdminScoutAnalyticsHandler({
  supabase,
  env: process.env
});
