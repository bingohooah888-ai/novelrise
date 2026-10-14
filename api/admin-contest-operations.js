import { createClient } from '@supabase/supabase-js';
import { createAdminContestOperationsHandler } from './_lib/admin-contest-operations.js';

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

export default createAdminContestOperationsHandler({
  supabase,
  env: process.env
});
