import { requireAdmin, applyAdminSecurityHeaders } from './admin-auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONS = new Set([
  'anomalous_reading',
  'duplicate_identity',
  'manual_evidence',
  'appeal_review',
  'false_positive',
  'other'
]);
const ACTIONS = new Set(['hold', 'clear', 'reopen']);
const EXPECTED = new Set(['provisional', 'review_hold', 'cleared']);

function fail(res, status, code) {
  return res.status(status).json({ ok: false, error: code });
}

async function resultOrFail(request) {
  const result = await request;
  if (result.error) throw result.error;
  return result;
}

export function createAdminContestReviewHandler({
  supabase,
  env = process.env
} = {}) {
  if (!supabase) throw new Error('supabase required');

  return async function adminContestReview(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('Allow', 'GET, POST');
    if (!['GET', 'POST'].includes(req.method)) {
      return fail(res, 405, 'METHOD_NOT_ALLOWED');
    }
    // Explicit Origin is required for write requests. The shared admin
    // guard also checks same-origin and validates the server-side bearer.
    if (req.method === 'POST' && !req.headers?.origin) {
      return fail(res, 403, 'ORIGIN_REQUIRED');
    }
    const admin = await requireAdmin({ req, res, supabase, env });
    if (!admin) return;

    try {
      const contestResult = await resultOrFail(
        supabase
          .from('novelight_contests')
          .select('id,status,public_visible')
          .eq('contest_key', 'novelight-november-2026')
          .maybeSingle()
      );
      const contest = contestResult.data;
      if (!contest) return fail(res, 503, 'CONTEST_NOT_CONFIGURED');

      if (req.method === 'POST') {
        const body = req.body;
        if (!body || typeof body !== 'object' ||
            Array.isArray(body) ||
            Object.keys(body).sort().join(',') !==
              'action,expected_status,note,reader_id,reason_code') {
          return fail(res, 400, 'INVALID_REQUEST');
        }
        const { action, expected_status, reader_id, reason_code, note } = body;
        if (!ACTIONS.has(action) || !EXPECTED.has(expected_status) ||
            !REASONS.has(reason_code) || !UUID.test(String(reader_id ?? '')) ||
            typeof note !== 'string' || note.trim().length < 20 ||
            note.length > 500) {
          return fail(res, 400, 'INVALID_REVIEW');
        }
        if (action === 'clear' &&
            !['manual_evidence', 'appeal_review', 'false_positive']
              .includes(reason_code)) {
          return fail(res, 400, 'INVALID_CLEAR_REASON');
        }
        const result = await resultOrFail(
          supabase.rpc('novelight_contest_admin_review_reader', {
            p_contest_id: contest.id,
            p_reader_id: reader_id,
            p_admin_user_id: admin.id,
            p_action: action,
            p_expected_status: expected_status,
            p_reason_code: reason_code,
            p_note: note.trim()
          })
        );
        if (result.data?.ok !== true) {
          return fail(res, 409, result.data?.reason || 'REVIEW_CONFLICT');
        }
        return res.status(200).json({
          ok: true,
          result: result.data,
          prize_finalized: false
        });
      }

      const readerId = req.query?.reader_id;
      if (readerId !== undefined) {
        if (typeof readerId !== 'string' || !UUID.test(readerId)) {
          return fail(res, 400, 'INVALID_READER_ID');
        }
        const readerResult = await resultOrFail(
          supabase
            .from('novelight_contest_readers')
            .select('id,kind,user_id,review_status,created_at,updated_at')
            .eq('contest_id', contest.id)
            .eq('id', readerId)
            .maybeSingle()
        );
        if (!readerResult.data) return fail(res, 404, 'READER_NOT_FOUND');
        const [risk, scores, audit] = await Promise.all([
          resultOrFail(supabase.rpc('novelight_contest_reader_risk_signals', {
            p_contest_id: contest.id,
            p_reader_id: readerId
          })),
          resultOrFail(
            supabase
              .from('novelight_contest_reader_scores')
              .select('entry_id,qualified_episode_count,points,review_status')
              .eq('contest_id', contest.id)
              .eq('reader_id', readerId)
              .order('points', { ascending: false })
              .limit(30)
          ),
          resultOrFail(
            supabase
              .from('novelight_contest_review_audit')
              .select('actor_user_id,action,reason_code,evidence_summary,created_at')
              .eq('contest_id', contest.id)
              .eq('reader_id', readerId)
              .order('created_at', { ascending: false })
              .limit(30)
          )
        ]);
        return res.status(200).json({
          ok: true,
          contest_status: contest.status,
          reader: readerResult.data,
          risk: risk.data,
          scores: scores.data,
          audit: audit.data,
          provisional_only: true
        });
      }

      const page = req.query?.page ?? '1';
      const limit = req.query?.limit ?? '20';
      if (typeof page !== 'string' || !/^[1-9][0-9]{0,2}$/.test(page) ||
          typeof limit !== 'string' || !['10', '20'].includes(limit)) {
        return fail(res, 400, 'INVALID_PAGINATION');
      }
      const offset = (Number(page) - 1) * Number(limit);
      const readerRows = await resultOrFail(
        supabase
          .from('novelight_contest_readers')
          .select('id,kind,user_id,review_status,created_at,updated_at', {
            count: 'exact'
          })
          .eq('contest_id', contest.id)
          .order('updated_at', { ascending: false })
          .order('id', { ascending: true })
          .range(offset, offset + Number(limit) - 1)
      );
      const readers = await Promise.all((readerRows.data ?? []).map(
        async (reader) => {
          const risk = await resultOrFail(
            supabase.rpc('novelight_contest_reader_risk_signals', {
              p_contest_id: contest.id,
              p_reader_id: reader.id
            })
          );
          return {
            ...reader,
            risk_codes: risk.data?.signal_codes ?? [],
            requires_manual_review:
              risk.data?.requires_manual_review === true
          };
        }
      ));
      return res.status(200).json({
        ok: true,
        contest_status: contest.status,
        public_visible: contest.public_visible,
        readers,
        total: readerRows.count ?? 0,
        page: Number(page),
        limit: Number(limit),
        provisional_only: true
      });
    } catch (error) {
      console.error('[contest-admin-review] request failed', error);
      return fail(res, 500, 'ADMIN_REVIEW_FAILED');
    }
  };
}
