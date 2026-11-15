// Dormant formal-only handler factory. This is NOT an api/ route.
// Future approved trusted host must inject a private PostgreSQL connection.
// Reuses the existing JWT/allowlist/same-origin requireAdmin guard.
import { randomUUID } from 'node:crypto';
import { requireAdmin, applyAdminSecurityHeaders } from '../admin-auth.js';
import { createFormalEarningRunner } from './formal-earning-runner.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

function validBody(body) {
  return (
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    Object.keys(body).sort().join(',') ===
      'comment_id,eligible,reviewed_body_sha256,reviewer_rule' &&
    typeof body.comment_id === 'string' &&
    UUID.test(body.comment_id) &&
    typeof body.eligible === 'boolean' &&
    typeof body.reviewer_rule === 'string' &&
    body.reviewer_rule.length >= 1 &&
    body.reviewer_rule.length <= 120 &&
    typeof body.reviewed_body_sha256 === 'string' &&
    SHA256.test(body.reviewed_body_sha256)
  );
}

function failure(res, status, code) {
  return res.status(status).json({ ok: false, error: code });
}

export function createFormalAdminCommentReviewHandler({
  supabase,
  postgresClient,
  releaseTimestampIso,
  launchConfiguration,
  trustedServerAuthorization,
  env = process.env
} = {}) {
  if (typeof supabase?.auth?.getUser !== 'function')
    throw new TypeError('Existing trusted Supabase Auth client required');
  if (typeof postgresClient?.query !== 'function')
    throw new TypeError('Private PostgreSQL connection required');

  return async function unregisteredFormalReview(req, res) {
    applyAdminSecurityHeaders(res);
    res.setHeader('Allow', 'POST');
    if (req?.method !== 'POST') return failure(res, 405, 'METHOD_NOT_ALLOWED');
    // No silent cross-origin write using a bearer token.
    if (!req.headers?.origin) return failure(res, 403, 'ORIGIN_REQUIRED');
    // Never allow an admin session by itself to authorize formal Point work.
    if (
      launchConfiguration?.formalEarningsEnabled !== true ||
      launchConfiguration?.productionCutoverApproved !== true ||
      launchConfiguration?.formalWorkerEnabled !== true ||
      trustedServerAuthorization?.serviceRoleVerified !== true ||
      trustedServerAuthorization?.verifiedByTrustedServer !== true
    ) {
      return failure(res, 403, 'FORMAL_REVIEW_DISABLED');
    }

    let admin;
    try {
      admin = await requireAdmin({ req, res, supabase, env });
    } catch {
      return failure(res, 503, 'FORMAL_REVIEW_UNAVAILABLE');
    }
    if (!admin) return;
    if (!validBody(req.body))
      return failure(res, 400, 'INVALID_REVIEW_REQUEST');
    const { comment_id, eligible, reviewer_rule, reviewed_body_sha256 } =
      req.body;

    // The browser can only assert which SHA-256 it reviewed; the server
    // fetches the canonical comment, hashes it independently, and the
    // private DB function re-checks while holding the source row lock.
    const receipt = Object.freeze({
      commentId: comment_id,
      eligible,
      rule: reviewer_rule,
      bodySha256: reviewed_body_sha256
    });
    const reviewId = randomUUID();
    const runner = createFormalEarningRunner({
      postgresClient,
      releaseTimestampIso,
      launchConfiguration,
      trustedServerAuthorization,
      verifyModeratorReceipt: async (input) =>
        input.reviewReceipt === receipt &&
        input.commentId === comment_id &&
        input.eligible === eligible &&
        input.rule === reviewer_rule &&
        UUID.test(admin.id)
          ? {
              reviewerId: admin.id,
              reviewId,
              bodySha256: receipt.bodySha256
            }
          : false
    });
    try {
      const result = await runner.submitModeration({
        commentId: comment_id,
        eligible,
        rule: reviewer_rule,
        reviewReceipt: receipt
      });
      if (
        result.status === 'review_recorded' ||
        result.status === 'review_already_recorded'
      ) {
        return res.status(200).json({ ok: true, status: result.status });
      }
      if (
        result.status === 'review_storage_unavailable' ||
        result.status === 'canonical_source_unavailable'
      ) {
        return failure(res, 503, 'FORMAL_REVIEW_UNAVAILABLE');
      }
      // Never echo raw database content or private review evidence.
      return failure(res, 409, result.status || 'REVIEW_HELD');
    } catch {
      return failure(res, 503, 'FORMAL_REVIEW_UNAVAILABLE');
    }
  };
}
