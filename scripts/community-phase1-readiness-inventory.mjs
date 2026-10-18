// Read-only inventory of the unmerged Community Phase 1 candidate.
// It never authenticates an OWNER, authorizes payment, or mutates services.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SHA = /^[a-f0-9]{40}$/u;
export const LEGACY_CANDIDATE_SHA = '6bf0ea608183e4977fcdaa17d36b1712974d5a49';
export const CANDIDATE_GUARD_PATHS = Object.freeze([
  'scripts/community-hosted-coordinator-bindings.mjs',
  'scripts/community-hosted-ordered-handoff.mjs',
  'scripts/community-hosted-precost-admission.mjs',
  'scripts/community-hosted-ledger-audit.mjs',
  'scripts/community-hosted-preprovision.mjs',
  'scripts/community-hosted-staging-evidence-shape.mjs',
  'scripts/community-hosted-write-admission.mjs',
  'scripts/community-staging-interaction-admission.mjs',
  '.github/workflows/community-staging-interaction-rollback.yml'
]);

function deny(reason) {
  throw new Error('COMMUNITY_PHASE1_READINESS_AUDIT: ' + reason);
}

// All inputs are caller-supplied, NOT independently authenticated evidence.
// Even an all-current inventory never grants staging or production access.
export function auditCommunityPhase1Readiness({
  mainSha,
  candidateSha,
  sourceByPath,
  approvalIssueState
} = {}) {
  if (!SHA.test(mainSha ?? '') || !SHA.test(candidateSha ?? '') ||
      mainSha === candidateSha || candidateSha === LEGACY_CANDIDATE_SHA) {
    deny('invalid or superseded immutable revision');
  }
  if (!sourceByPath || typeof sourceByPath !== 'object' ||
      Array.isArray(sourceByPath)) {
    deny('complete local source inventory is required');
  }
  const stalePins = [];
  const currentPins = [];
  const unclassified = [];
  for (const path of CANDIDATE_GUARD_PATHS) {
    if (typeof sourceByPath[path] !== 'string') {
      deny('missing source for ' + path);
    }
    const content = sourceByPath[path];
    if (content.includes(LEGACY_CANDIDATE_SHA)) stalePins.push(path);
    if (content.includes(candidateSha)) currentPins.push(path);
    if (!content.includes(LEGACY_CANDIDATE_SHA) &&
        !content.includes(candidateSha)) unclassified.push(path);
  }
  const blockers = [];
  if (stalePins.length) blockers.push('STALE_CANDIDATE_SHA_PINS');
  if (unclassified.length) blockers.push('UNCLASSIFIED_CANDIDATE_GUARDS');
  if (approvalIssueState !== 'open') {
    blockers.push('CONTROL_ISSUE_NOT_CONFIRMED_OPEN');
  }
  blockers.push('INDEPENDENT_ENVIRONMENT_AND_PROVIDER_SPEND_PROOF_MISSING');
  blockers.push('HOSTED_USER_MODERATION_AND_CLEANUP_PROOF_MISSING');
  blockers.push('STAGING_SCHEMA_PARITY_AND_ISOLATION_NOT_AUTHENTICATED');
  return Object.freeze({
    mode: 'READ_ONLY_PREAPPROVAL_INVENTORY',
    mainSha,
    candidateSha,
    stalePins,
    currentPins,
    unclassified,
    controlIssueState: approvalIssueState ?? 'unknown',
    controlIssueStateAuthentication: false,
    blockers,
    safeToMergeProduction: false,
    ownerApprovalGranted: false,
    stagingCostApproved: false,
    mayClaim: false,
    mayProvision: false,
    mayRunHostedBrowser: false,
    mayMutateProduction: false
  });
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mainSha, candidateSha, approvalIssueState] = process.argv.slice(2);
    const sourceByPath = Object.fromEntries(
      CANDIDATE_GUARD_PATHS.map((path) => [path, readFileSync(path, 'utf8')])
    );
    console.log(JSON.stringify(auditCommunityPhase1Readiness({
      mainSha, candidateSha, sourceByPath, approvalIssueState
    }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
