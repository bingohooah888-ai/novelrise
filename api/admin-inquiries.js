import { createClient } from '@supabase/supabase-js';
import { createAdminInquiriesHandler } from './_lib/admin-operations.js';

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

export default createAdminInquiriesHandler({
  supabase,
  env: process.env
});
