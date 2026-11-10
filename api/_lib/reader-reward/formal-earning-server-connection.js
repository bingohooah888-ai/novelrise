// Formal reader reward server connection CONTRACT, never registered as a route.
// No Supabase client, network I/O, Point issue or beta change occurs here.
// The only writer after future owner-approved release will be the formal
// private SQL transaction; handlers must NOT write scout_point_ledger directly.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHODS = Object.freeze({
  valid_read_qualified: 'award_read_points_draft',
  novel_episode_comment_reviewed: 'award_comment_points_draft'
});
const READ_TRIGGER = 'scout_formal_read_level_capture';

function nonemptyId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new TypeError('Verified canonical event UUID is required');
  }
  return value.toLowerCase();
}
function validRelease(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(
      'Server-configured formal release ISO timestamp required'
    );
  }
  return value;
}

/**
 * Produces a ready-to-wire *plan* for an authoritative server-side event.
 * It cannot execute: not even if a caller passes a Supabase client.
 * Future approved implementation must perform the actual RPC only after
 * formal launch checks, wallet budgeting, eligibility and audit are ready.
 *
 * Event delivery order:
 * 1. qualification: canonical valid_read_events INSERT, future formal
 *    trigger records the read-time level in the SAME DB transaction.
 * 2. post-commit event consumer: confirm durable read+level evidence, invoke
 *    award_read_points_draft inside the database transaction.
 * 3. reviewed episode comment: check comment content attestation by server,
 *    invoke award_comment_points_draft, whose own user row lock and event
 *    key uniqueness determine the only eligible comment in an episode.
 */
export function planFormalEarningServerConnection({
  eventType,
  verifiedEventId,
  releaseTimestampIso,
  sourceCommitted,
  serverPrincipalVerified,
  authoritativeEvidenceVerified,
  commentModerationApproved
}) {
  if (!(eventType in METHODS)) {
    return Object.freeze({
      status: 'unsupported_formal_event',
      mayIssuePoints: false
    });
  }
  const eventId = nonemptyId(verifiedEventId);
  const release = validRelease(releaseTimestampIso);
  if (
    sourceCommitted !== true ||
    serverPrincipalVerified !== true ||
    authoritativeEvidenceVerified !== true
  ) {
    return Object.freeze({
      status: 'server_evidence_pending',
      mayIssuePoints: false
    });
  }
  if (
    eventType === 'novel_episode_comment_reviewed' &&
    commentModerationApproved !== true
  ) {
    return Object.freeze({
      status: 'comment_moderation_pending',
      mayIssuePoints: false
    });
  }
  return Object.freeze({
    status: 'private_rpc_wiring_plan_only',
    schema: 'novelight_formal_private',
    functionName: METHODS[eventType],
    params: Object.freeze(
      eventType === 'valid_read_qualified'
        ? { p_read_event_id: eventId, p_release_at: release }
        : { p_comment_id: eventId, p_release_at: release }
    ),
    requiresReadTimeTrigger:
      eventType === 'valid_read_qualified' ? READ_TRIGGER : null,
    sourceCommitted: true,
    useSupabaseServiceRoleOnTrustedServerOnly: true,
    mustRecheckCanonicalSourceInDatabase: true,
    pointLedgerWriteInDatabaseTransactionOnly: true,
    // Explicitly NO live invocation, no Staging/Production grant execution.
    mayIssuePoints: false
  });
}

/**
 * Test-only simulator for an already-built plan. Requires a callback passed
 * by a unit test; no RPC client is constructed and no real DB client is used.
 */
export async function simulateFormalEarningServerConnection({
  plan,
  mockPrivateRpc
}) {
  if (!plan || plan.status !== 'private_rpc_wiring_plan_only') {
    return Object.freeze({ status: 'not_ready', mayIssuePoints: false });
  }
  if (typeof mockPrivateRpc !== 'function' || mockPrivateRpc.isMock !== true) {
    return Object.freeze({ status: 'mock_required', mayIssuePoints: false });
  }
  const response = await mockPrivateRpc(
    plan.schema,
    plan.functionName,
    plan.params
  );
  return Object.freeze({
    status: 'mock_rpc_response_only',
    resultStatus:
      typeof response?.status === 'string' ? response.status : 'unknown',
    mayIssuePoints: false
  });
}
