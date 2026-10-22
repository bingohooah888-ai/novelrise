// Stage 05 ONLY: pure, fail-closed validation and SQL plan construction.
// This module NEVER connects to Production, runs SQL, posts approvals or opens registration.
// A separately reviewed OWNER-only execution workflow and an explicit
// "受付開始承認" are required before any generated SQL may be executed.
import { createHash } from 'node:crypto';

export const CONTEST_REGISTRATION_PREFIX =
  'NOVELIGHT_CONTEST_REGISTRATION_OPEN_APPROVE ';
export const CONTEST_KEY = 'novelight-november-2026';
export const TERMS_VERSION = 'december-2026-v2';
export const TERMS_URL = 'https://novelight.jp/contest-terms';
export const CONTROL_ISSUE = 2120;
const REPOSITORY = 'bingohooah888-ai/novelrise';
const OWNER = 'bingohooah888-ai';
const SHA = /^[0-9a-f]{40}$/;
const REQUEST_ID = /^contest-regopen-[a-z0-9-]{12,60}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const ATTESTATIONS = [
  'termsAdopted',
  'legalReviewCompleted',
  'residentAndNonresidentTaxReviewed',
  'recipientIdentityAndMailVerified',
  'personalDataHandlingReviewed',
  'payoutBudgetConfirmed',
  'publicSmokeOperatorReady'
];

function assert(condition, message) {
  if (!condition) throw new Error('STEP05_APPROVAL_BLOCKED: ' + message);
}

function exactKeys(value, keys) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

export function expectedRegistrationChallenge(payload) {
  return createHash('sha256')
    .update(
      'novelight-step05-registration-open:' +
      payload.mainSha +
      ':' +
      payload.requestId +
      ':' +
      payload.termsSourceSha
    )
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
}

export function verifyRegistrationOpenApproval(context) {
  assert(exactKeys(context, [
    'repository', 'issueNumber', 'commentAuthor', 'authorAssociation',
    'commentBody', 'commentId', 'currentMainSha',
    'currentTermsSourceSha', 'termsAdoptionEvidence', 'now'
  ]), 'unrecognized trusted context');
  assert(context.repository === REPOSITORY, 'wrong repository');
  assert(context.issueNumber === CONTROL_ISSUE, 'wrong control issue');
  assert(context.commentAuthor === OWNER &&
    context.authorAssociation === 'OWNER', 'owner-authored comment required');
  assert(Number.isSafeInteger(context.commentId) && context.commentId > 0,
    'invalid owner comment ID');
  assert(typeof context.commentBody === 'string' &&
    context.commentBody.startsWith(CONTEST_REGISTRATION_PREFIX),
  'explicit registration-open prefix absent');

  let p;
  try {
    p = JSON.parse(context.commentBody.slice(CONTEST_REGISTRATION_PREFIX.length));
  } catch {
    throw new Error('STEP05_APPROVAL_BLOCKED: malformed approval JSON');
  }
  assert(exactKeys(p, [
    'version', 'operation', 'requestId', 'mainSha', 'contestKey',
    'termsVersion', 'termsUrl', 'termsSourceSha', 'termsAdoptionCommentId',
    'issuedAt', 'expiresAt', 'challenge', 'confirmation', 'attestations'
  ]), 'approval JSON schema mismatch');
  assert(p.version === 1 && p.operation === 'open-december-contest-registration',
    'operation not allowed');
  assert(REQUEST_ID.test(p.requestId), 'request identity invalid');
  assert(SHA.test(p.mainSha) && p.mainSha === context.currentMainSha,
    'approved main SHA is stale');
  assert(p.contestKey === CONTEST_KEY &&
    p.termsVersion === TERMS_VERSION && p.termsUrl === TERMS_URL,
    'contest or official terms mismatch');
  assert(SHA.test(p.termsSourceSha) &&
    p.termsSourceSha === context.currentTermsSourceSha,
    'terms template changed since approval');
  assert(Number.isSafeInteger(p.termsAdoptionCommentId) &&
    p.termsAdoptionCommentId > 0, 'official terms adoption evidence missing');
  assert(p.confirmation === 'CHAT_CONTEST_REGISTRATION_APPROVED',
    'an ordinary yes or Production approval is not registration approval');
  assert(p.challenge === expectedRegistrationChallenge(p),
    'challenge does not match exact release identity');
  assert(exactKeys(p.attestations, ATTESTATIONS) &&
    ATTESTATIONS.every((name) => p.attestations[name] === true),
    'operator attestation missing');

  assert(ISO.test(p.issuedAt) && ISO.test(p.expiresAt),
    'UTC issue and expiry times required');
  const issued = Date.parse(p.issuedAt);
  const expiry = Date.parse(p.expiresAt);
  const now = Date.parse(context.now);
  assert(Number.isFinite(now) && Number.isFinite(issued) &&
    Number.isFinite(expiry), 'invalid timestamps');
  assert(issued <= now && now < expiry &&
    expiry - issued <= 15 * 60 * 1000,
    'registration approval expired or issued in future');

  const adopted = context.termsAdoptionEvidence;
  assert(exactKeys(adopted, [
    'ownerVerified', 'commentId', 'termsSourceSha', 'termsVersion', 'termsUrl'
  ]) && adopted.ownerVerified === true &&
    adopted.commentId === p.termsAdoptionCommentId &&
    adopted.termsSourceSha === p.termsSourceSha &&
    adopted.termsVersion === TERMS_VERSION &&
    adopted.termsUrl === TERMS_URL,
  'independent owner terms-adoption evidence not verified');

  return Object.freeze({
    requestId: p.requestId,
    mainSha: p.mainSha,
    commentId: context.commentId,
    termsAdoptionCommentId: p.termsAdoptionCommentId,
    termsVersion: TERMS_VERSION,
    termsUrl: TERMS_URL,
    challenge: p.challenge,
    approvalContractValidated: true,
    productionMutationPerformed: false
  });
}

// This SQL is an *inert string*. Never execute it directly from chat or this
// module. Only a separately approved, idempotent one-time Production workflow
// may use it, after a fresh read-only DB preflight and release audit claim.
export function buildAtomicRegistrationOpenSql(verified) {
  assert(verified?.approvalContractValidated === true &&
    verified?.productionMutationPerformed === false &&
    SHA.test(verified.mainSha) &&
    Number.isSafeInteger(verified.commentId) &&
    verified.commentId > 0 &&
    /^[A-F0-9]{8}$/.test(verified.challenge),
  'trusted validated release plan required');
  const releaseId = 'github-comment-' + verified.commentId;
  return [
    '-- DANGEROUS IF EXECUTED: requires separate one-time OWNER and Production gates.',
    '-- Does not start reading points, schedule ranking Cron, or issue awards.',
    // The Management Query API public beta docs do not establish
    // multi-statement transaction semantics. Send one DO statement so a
    // failed UPDATE or audit INSERT rolls back the entire statement.
    'do $novelight_stage05_open$',
    'declare',
    '  v_contest public.novelight_contests%rowtype;',
    '  v_updated integer;',
    '  v_now timestamptz := pg_catalog.clock_timestamp();',
    'begin',
    "  perform pg_catalog.set_config('lock_timeout', '5s', true);",
    "  perform pg_catalog.set_config('statement_timeout', '20s', true);",
    "  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('novelight:contest:registration-open'));",
    '  select * into strict v_contest from public.novelight_contests',
    "   where contest_key = 'novelight-november-2026' for update;",
    "  if v_contest.status <> 'draft' or v_contest.public_visible is not false",
    "     or v_contest.terms_version not in ('', 'december-2026-v2')",
    "     or v_contest.terms_url not in ('', 'https://novelight.jp/contest-terms')",
    "     or v_contest.minimum_published_episodes <> 10",
    "     or v_contest.entry_deadline_at <> '2026-11-30 14:59:59.999999+00'::timestamptz",
    "     or v_contest.starts_at <> '2026-11-30 15:00:00+00'::timestamptz",
    "     or v_contest.ends_at <> '2026-12-31 15:00:00+00'::timestamptz",
    '     or v_now >= v_contest.entry_deadline_at',
    '     or v_now >= v_contest.starts_at then',
    "    raise exception 'STEP05_REGISTRATION_OPEN_BLOCKED: stale state or expired window';",
    '  end if;',
    '  if exists (select 1 from public.novelight_contest_entries',
    '     where contest_id = v_contest.id) then',
    "    raise exception 'STEP05_REGISTRATION_OPEN_BLOCKED: entries unexpectedly exist';",
    '  end if;',
    '  update public.novelight_contests',
    "     set terms_version = 'december-2026-v2',",
    "         terms_url = 'https://novelight.jp/contest-terms',",
    "         status = 'registration', public_visible = true,",
    '         updated_at = v_now',
    "   where id = v_contest.id and status = 'draft' and public_visible = false;",
    '  get diagnostics v_updated = row_count;',
    '  if v_updated <> 1 then',
    "    raise exception 'STEP05_REGISTRATION_OPEN_BLOCKED: atomic update missing';",
    '  end if;',
    '  insert into public.novelight_contest_review_audit',
    '    (contest_id, action, reason_code, evidence_summary)',
    '  values (v_contest.id,',
    "    'registration_open', 'explicit_owner_chat_approval',",
    '    pg_catalog.jsonb_build_object(',
    "      'approval_comment', '" + releaseId + "',",
    "      'approval_main_sha', '" + verified.mainSha + "',",
    "      'approval_challenge', '" + verified.challenge + "',",
    "      'terms_version', 'december-2026-v2',",
    "      'terms_url', 'https://novelight.jp/contest-terms'));",
    'end;',
    '$novelight_stage05_open$;'
  ].join('\n') + '\n';
}
