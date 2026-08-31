import { createClient } from '@supabase/supabase-js';
import { createAdminDashboardHandler } from './_lib/admin-dashboard.js';

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

export default createAdminDashboardHandler({
  supabase,
  env: process.env
});
