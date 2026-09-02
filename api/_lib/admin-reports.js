import { requireAdmin } from './admin-auth.js';

const REPORT_COLUMNS =
  'id,novel_id_snapshot,episode_id_snapshot,category,status,created_at';

export async function loadReportSummaries(supabase) {
  const { data, error } = await supabase
    .from('content_reports')
    .select(REPORT_COLUMNS)
    .in('status', ['new', 'reviewing'])
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  return data ?? [];
}

export function createAdminReportsHandler({
  supabase,
  env = process.env,
  loadReports = loadReportSummaries
}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const admin = await requireAdmin({ req, res, supabase, env });
    if (!admin) return;

    try {
      return res.status(200).json({ reports: await loadReports(supabase) });
    } catch (error) {
      console.error('NOVELIGHT ADMIN reports request failed', {
        message: error?.message ?? 'unknown error'
      });
      return res.status(500).json({ error: 'ADMIN reports unavailable' });
    }
  };
}
