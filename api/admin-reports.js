import { createClient } from '@supabase/supabase-js';
import { createAdminReportsHandler } from './_lib/admin-reports.js';

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

export default createAdminReportsHandler({
  supabase,
  env: process.env
});
