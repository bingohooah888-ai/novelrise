import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from './_lib/admin-auth.js';
import { loadR2CostGuardStatus } from './_lib/ai/r2-cost-guard-status.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const admin = await requireAdmin({ req, res, supabase, env: process.env });
  if (!admin) return;

  const status = await loadR2CostGuardStatus();
  return res.status(200).json(status);
}
