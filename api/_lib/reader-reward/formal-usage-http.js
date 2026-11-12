// Unregistered formal release HTTP handler factories.
// These are reusable server actions, NOT Vercel public API routes.
// App wiring, payment/AI providers and live DB connection are intentionally
// absent until OWNER-approved activation.
import {
  applyAdminSecurityHeaders,
  isSameOriginRequest,
  requireAdmin
} from '../admin-auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fieldsAre = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === keys.sort().join('|');
const bearer = (value) =>
  typeof value === 'string'
    ? (value.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null)
    : null;

function stop(res, code, error) {
  return res.status(code).json({ ok: false, error });
}
function mapResult(res, result) {
  const status = result?.status;
  const allowed = new Set([
    'request_received',
    'started',
    'already_processed',
    'committed',
    'released',
    'refunded',
    'queue_ready',
    'refund_candidates_ready'
  ]);
  if (allowed.has(status)) {
    return res.status(status === 'request_received' ? 202 : 200).json({
      ok: true,
      ...result
    });
  }
  if (status === 'formal_use_disabled') return stop(res, 403, status);
  if (status === 'invalid_request' || status === 'unsupported_purpose')
    return stop(res, 400, status);
  if (
    status === 'wallet_unavailable' ||
    status === 'wallet_or_budget_unavailable'
  )
    return stop(res, 503, 'FORMAL_REWARD_UNAVAILABLE');
  if (typeof status === 'string' && status.length < 100)
    return stop(res, 409, status);
  return stop(res, 503, 'FORMAL_REWARD_UNAVAILABLE');
}

export function createFormalUsageHttpHandlers({
  supabase,
  service,
  env = process.env,
  initializeNewReader,
  inspectNewReader,
  inspectEarningSource,
  getNewReaderSummary
} = {}) {
  if (typeof supabase?.auth?.getUser !== 'function')
    throw new TypeError('Trusted existing Supabase Auth client required');
  for (const method of [
    'getReaderSnapshot',
    'requestExchange',
    'requestAiUse',
    'listPendingExchanges',
    'listRefundCandidates',
    'resolveExchange',
    'refundCommitted'
  ]) {
    if (typeof service?.[method] !== 'function')
      throw new TypeError('Formal reward service method missing: ' + method);
  }

  async function guard(req, res) {
    applyAdminSecurityHeaders(res);
    if (!isSameOriginRequest(req)) {
      stop(res, 403, 'FORBIDDEN');
      return null;
    }
    if (req.method === 'POST' && !req.headers?.origin) {
      stop(res, 403, 'ORIGIN_REQUIRED');
      return null;
    }
    const token = bearer(req.headers?.authorization);
    if (!token) {
      stop(res, 401, 'UNAUTHORIZED');
      return null;
    }
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !UUID.test(data?.user?.id || '')) {
        stop(res, 401, 'UNAUTHORIZED');
        return null;
      }
      return data.user;
    } catch {
      stop(res, 503, 'AUTH_UNAVAILABLE');
      return null;
    }
  }

  async function reader(req, res) {
    const user = await guard(req, res);
    if (!user) return;
    try {
      if (req.method === 'GET') {
        if (req.query?.view === 'new_reader') {
          if (typeof inspectNewReader !== 'function')
            return stop(res, 503, 'FORMAL_NEW_READER_UNAVAILABLE');
          const report = await inspectNewReader(user.id);
          return res.status(200).json({
            ok: true,
            status: report.status,
            counts: report.counts ?? null,
            initialLevel: report.initialLevel ?? null,
            initialAvailablePoints: report.initialAvailablePoints ?? null
          });
        }
        const snapshot = await service.getReaderSnapshot(user.id);
        return snapshot.serverVerified
          ? res.status(200).json(snapshot)
          : mapResult(res, snapshot);
      }
      if (req.method !== 'POST') return stop(res, 405, 'METHOD_NOT_ALLOWED');
      if (
        fieldsAre(req.body, ['action']) &&
        req.body.action === 'initialize_new_formal_reader'
      ) {
        if (typeof initializeNewReader !== 'function')
          return stop(res, 403, 'FORMAL_NEW_READER_DISABLED');
        // The user ID comes from verified Supabase Auth, never POST body.
        const result = await initializeNewReader(user.id);
        if (
          result?.status === 'new_reader_initialized' ||
          result?.status === 'new_reader_already_initialized'
        )
          return res.status(200).json({ ok: true, status: result.status });
        if (result?.status === 'new_reader_initialization_disabled')
          return stop(res, 403, 'FORMAL_NEW_READER_DISABLED');
        return stop(res, 409, result?.status || 'FORMAL_NEW_READER_HOLD');
      }
      if (
        fieldsAre(req.body, ['action', 'operationId', 'amountPoints']) &&
        req.body.action === 'exchange_request' &&
        UUID.test(req.body.operationId || '') &&
        Number.isSafeInteger(req.body.amountPoints)
      ) {
        return mapResult(
          res,
          await service.requestExchange({
            userId: user.id,
            operationId: req.body.operationId,
            amountPoints: req.body.amountPoints
          })
        );
      }
      if (
        fieldsAre(req.body, ['action', 'operationId', 'featureId']) &&
        req.body.action === 'ai_use' &&
        UUID.test(req.body.operationId || '') &&
        typeof req.body.featureId === 'string'
      ) {
        return mapResult(
          res,
          await service.requestAiUse({
            userId: user.id,
            operationId: req.body.operationId,
            featureId: req.body.featureId
          })
        );
      }
      return stop(res, 400, 'INVALID_REWARD_REQUEST');
    } catch {
      return stop(res, 503, 'FORMAL_REWARD_UNAVAILABLE');
    }
  }

  async function admin(req, res) {
    applyAdminSecurityHeaders(res);
    let reviewer;
    try {
      reviewer = await requireAdmin({ req, res, supabase, env });
    } catch {
      return stop(res, 503, 'ADMIN_AUTH_UNAVAILABLE');
    }
    if (!reviewer) return;
    try {
      if (req.method === 'GET') {
        if (req.query?.view === 'earning_source') {
          if (typeof inspectEarningSource !== 'function')
            return stop(res, 503, 'FORMAL_EARNING_SOURCE_UNAVAILABLE');
          const { eventType, eventId } = req.query;
          if (
            ![
              'valid_read_qualified',
              'novel_episode_comment_reviewed'
            ].includes(eventType) ||
            typeof eventId !== 'string' ||
            !UUID.test(eventId)
          )
            return stop(res, 400, 'INVALID_EARNING_SOURCE');
          const report = await inspectEarningSource(eventType, eventId);
          // No comment body, reader identity, review verdict, or raw SQL
          // data is sent to the browser.
          return res.status(200).json({
            ok: true,
            eventType,
            status: report.status,
            mayIssuePoints: false
          });
        }
        if (req.query?.view === 'new_readers') {
          if (typeof getNewReaderSummary !== 'function')
            return stop(res, 503, 'FORMAL_NEW_READER_UNAVAILABLE');
          return res.status(200).json({
            ok: true,
            ...(await getNewReaderSummary())
          });
        }
        return req.query?.view === 'refunds'
          ? mapResult(res, await service.listRefundCandidates())
          : mapResult(res, await service.listPendingExchanges());
      }
      if (req.method !== 'POST') return stop(res, 405, 'METHOD_NOT_ALLOWED');
      if (!req.headers?.origin) return stop(res, 403, 'ORIGIN_REQUIRED');
      if (
        !fieldsAre(req.body, ['action', 'operationId']) ||
        !UUID.test(req.body.operationId || '') ||
        ![
          'confirm_fulfilled',
          'release_unfulfilled',
          'refund_recovered'
        ].includes(req.body.action)
      )
        return stop(res, 400, 'INVALID_ADMIN_ACTION');
      // Only an independently verified recovery can restore a committed debit.
      if (req.body.action === 'refund_recovered')
        return mapResult(
          res,
          await service.refundCommitted({
            operationId: req.body.operationId,
            reviewerId: reviewer.id
          })
        );
      // No browser-supplied reviewer ID or provider evidence: reviewerId is
      // taken from requireAdmin, and the provider is queried by the service.
      return mapResult(
        res,
        await service.resolveExchange({
          operationId: req.body.operationId,
          action: req.body.action,
          reviewerId: reviewer.id
        })
      );
    } catch {
      return stop(res, 503, 'FORMAL_REWARD_UNAVAILABLE');
    }
  }

  return Object.freeze({ reader, admin });
}
