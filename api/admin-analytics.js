import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from './_lib/admin-auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function normalizeDays(value) {
  const days = Number.parseInt(String(value ?? '30'), 10);
  return [7, 30, 90].includes(days) ? days : 30;
}

function isSchemaNotReady(error) {
  if (!error) return false;
  const text = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    text.includes('novelight_admin_analytics_snapshot')
  );
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const admin = await requireAdmin({ req, res, supabase, env: process.env });
  if (!admin) return;

  const days = normalizeDays(req.query?.days);
  try {
    const { data, error } = await supabase.rpc(
      'novelight_admin_analytics_snapshot',
      { p_days: days }
    );
    if (error) throw error;
    res.setHeader(
      'Cache-Control',
      'private, max-age=60, stale-while-revalidate=120'
    );
    return res.status(200).json({ analytics: data });
  } catch (error) {
    if (isSchemaNotReady(error)) {
      return res.status(503).json({
        error: 'Admin analytics schema is not ready',
        code: 'ADMIN_ANALYTICS_NOT_READY'
      });
    }
    console.error('NOVELIGHT admin analytics failed', {
      message: error?.message ?? 'unknown error'
    });
    return res.status(500).json({ error: 'ADMIN analytics unavailable' });
  }
}
