import { createClient } from '@supabase/supabase-js';
import { createAdminCommunityHandler } from './_lib/admin-community.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default createAdminCommunityHandler({ supabase, env: process.env });
