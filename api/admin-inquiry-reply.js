import { createClient } from '@supabase/supabase-js';

import { createAdminInquiryReplyHandler } from './_lib/admin-inquiry-reply.js';

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

export default createAdminInquiryReplyHandler({
  supabase,
  env: process.env
});
