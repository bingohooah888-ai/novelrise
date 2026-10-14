import { requireAdmin, applyAdminSecurityHeaders } from './admin-auth.js';

const ENTRY_STATUSES = new Set([
  'all',
  'entered',
  'withdrawn',
  'ineligible',
  'disqualified'
]);

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

async function checked(query) {
  const result = await query;
  if (result.error) throw result.error;
  return result.data;
}

/**
 * Step 09: a strictly read-only, private operator overview.
 * No award finalization, contest activation, automatic action or bank data.
 */
export function createAdminContestOperationsHandler({
  supabase,
  env = process.env
} = {}) {
  if (!supabase) throw new Error('supabase required');

  return async function adminContestOperations(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('Allow', 'GET');
    if (req.method !== 'GET') return fail(res, 405, 'METHOD_NOT_ALLOWED');

    const admin = await requireAdmin({ req, res, supabase, env });
    if (!admin) return;

    const page = req.query?.page ?? '1';
    const limit = req.query?.limit ?? '20';
    const status = req.query?.status ?? 'all';
    if (
      typeof page !== 'string' ||
      !/^[1-9][0-9]{0,2}$/.test(page) ||
      Number(page) > 101 ||
      typeof limit !== 'string' ||
      !['10', '20'].includes(limit) ||
      typeof status !== 'string' ||
      !ENTRY_STATUSES.has(status)
    ) {
      return fail(res, 400, 'INVALID_PAGINATION');
    }

    try {
      const contest = await checked(
        supabase
          .from('novelight_contests')
          .select('id')
          .eq('contest_key', 'novelight-november-2026')
          .maybeSingle()
      );
      if (!contest) return fail(res, 503, 'CONTEST_NOT_CONFIGURED');

      const result = await checked(
        supabase.rpc('novelight_contest_admin_operations_overview', {
          p_contest_id: contest.id,
          p_entry_status: status === 'all' ? null : status,
          p_limit: Number(limit),
          p_offset: (Number(page) - 1) * Number(limit)
        })
      );
      if (result?.ok !== true) {
        return fail(res, 409, result?.reason || 'OPERATIONS_UNAVAILABLE');
      }
      return res.status(200).json({
        ...result,
        page: Number(page),
        limit: Number(limit),
        status_filter: status,
        awards_finalized_here: false,
        payment_actions_available: false
      });
    } catch (error) {
      console.error('[admin-contest-operations] private overview failed', {
        message: error?.message || 'unknown'
      });
      return fail(res, 500, 'OPERATIONS_UNAVAILABLE');
    }
  };
}
