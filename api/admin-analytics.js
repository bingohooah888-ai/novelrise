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

function isMissingRpc(error) {
  return error?.code === '42883' || error?.code === 'PGRST202';
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

async function optionalRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (!error) return data;
  if (isMissingRpc(error)) return null;
  throw error;
}

function mergeAcquisitionRetention(acquisition, retention) {
  const retentionBySource = new Map(
    (Array.isArray(retention) ? retention : []).map((row) => [
      String(row?.source || 'direct'),
      row
    ])
  );

  return (Array.isArray(acquisition) ? acquisition : []).map((row) => ({
    ...row,
    ...(retentionBySource.get(String(row?.source || 'direct')) || {})
  }));
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

    const [sourceRetention, scoutShareAttribution] = await Promise.all([
      optionalRpc('novelight_admin_acquisition_retention', { p_days: days }),
      optionalRpc('novelight_admin_scout_share_snapshot', { p_days: days })
    ]);

    const analytics = {
      ...(data || {}),
      acquisition: mergeAcquisitionRetention(
        data?.acquisition,
        sourceRetention
      ),
      scoutShareAttribution: scoutShareAttribution || null
    };

    res.setHeader(
      'Cache-Control',
      'private, max-age=60, stale-while-revalidate=120'
    );
    return res.status(200).json({ analytics });
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
