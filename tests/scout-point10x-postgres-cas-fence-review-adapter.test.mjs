import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import {
  OWNER_LOGIN,
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  SOURCE_RPC_SHA256,
  FIXED_CANDIDATE_RPC_SHA256,
  REQUEST_FIELDS
} from '../scripts/scout-point10x-atomic-staging-plan.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT,
  MARKER_SQL_SHA256,
  PRIVATE_SCHEMA
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from '../scripts/scout-point10x-durable-fence-model.mjs';
import {
  RECOVERY_WRITER_CLASSES,
  RECOVERY_RELATIONS
} from '../scripts/scout-point10x-recovery-drain-model.mjs';
import {
  PG_CONTROL_STEPS,
  PG_DATA_PLANE_STEPS,
  PG_REQUIRED_CATALOG_ROUTES,
  PG_REVIEW_BLOCKERS,
  POSTGRES_REVIEW_DOCUMENT,
  buildPoint10xPostgresReviewAdapter,
  reviewLostPostgresCasAcknowledgement
} from '../scripts/scout-point10x-postgres-cas-fence-review-adapter.mjs';

const SHA_A = 'a'.repeat(40),
  SHA_B = 'b'.repeat(40),
  HEX = 'c'.repeat(64);
function fixture() {
  const request = {
    scope: ATOMIC_PROOF_SCOPE,
    mode: APPROVAL_MODES.proof,
    mainSha: SHA_A,
    candidateSha: SHA_B,
    stagingRef: STAGING_PROJECT,
    operationId: 'pg-review-atomic-0001',
    sourceSnapshotSha256: HEX,
    markerSqlSha256: MARKER_SQL_SHA256,
    legacyRpcSha256: SOURCE_RPC_SHA256,
    candidateRpcSha256: FIXED_CANDIDATE_RPC_SHA256
  };
  const trustedMainEvidence = {
    owner: OWNER_LOGIN,
    issueNumber: 294,
    ownerAssociation: 'OWNER',
    authorActorMatches: true,
    triggeringActorMatches: true,
    issueHistoryFullyFetched: true,
    verifiedByTrustedMainFixture: true,
    commentId: 9031,
    canonicalCommentId: 9031,
    runId: 5001,
    mainSha: SHA_A,
    candidateSha: SHA_B,
    scope: request.scope,
    mode: request.mode,
    projectRef: STAGING_PROJECT,
    secretsOpened: false,
    githubClaimAlreadyPosted: false,
    approvalPreviouslySpent: false,
    expectedDomainVersion: 7,
    expectedDomainEpoch: 12
  };
  const controlPlane = {
    domain: MUTATION_DOMAIN,
    primaryDomainVersion: 7,
    primaryDomainEpoch: 12,
    controlSchema: PRIVATE_SCHEMA,
    controlDatabaseRole: 'dedicated_point10x_control_role',
    separateFromStagingAndProduction: true,
    serializableSingleTransaction: true,
    lockDomainRowForUpdate: true,
    spentCommentUnique: true,
    spentOperationUnique: true,
    spentScopeHeadUnique: true,
    persistEpochAndSpendTogether: true,
    conditionalNoConcurrentActiveClaim: true,
    readOnlyPrimaryRequeryOnLostAck: true,
    immutableSpentTombstones: true,
    strictPrivateSchemaOwnership: true,
    noPublicOrServiceRoleGrant: true,
    sharedMutationDomainAcrossOldAndNew: true,
    stagingRestoreCannotDecreaseAuthoritativeEpoch: true,
    controlPlaneFailureHoldsAllMutations: true,
    noAutomaticLeaseExpiryRelease: true,
    githubIssueIsSecondaryAudit: true
  };
  const dataPlane = {
    domain: MUTATION_DOMAIN,
    expectedFenceEpoch: 13,
    targetProject: STAGING_PROJECT,
    writers: RECOVERY_WRITER_CLASSES.map((kind) => ({
      kind,
      admissionClosed: true,
      inflight: 0,
      retry: 0,
      queued: 0,
      outbox: 0,
      unacked: 0,
      oldEpochRejectedByDb: true,
      dbEnforcementCatalogChecked: true
    })),
    privileged: PG_REQUIRED_CATALOG_ROUTES.map((path) => ({
      path,
      revokedOrFencedAtDatabase: true,
      bypassImpossibleForAffectedActor: true,
      catalogFingerprintChecked: true
    })),
    relations: RECOVERY_RELATIONS.map((relation) => ({
      relation,
      dmlInsertDeniedWhenFrozen: true,
      dmlUpdateDeniedWhenFrozen: true,
      dmlDeleteDeniedWhenFrozen: true,
      truncateDeniedWhenFrozen: true,
      ownershipAclTriggersVerified: true
    })),
    legacyRpcCannotBypassFreeze: true,
    noUnreviewedOwnerOrSuperuserPath: true,
    noForgedSessionGucAsAuthority: true,
    fenceSurvivesStagingRestore: true,
    allWritersUseSamePrimaryEpoch: true,
    fenceHeldThroughUncertainCommit: true,
    restoreIndependentOfLiveStaging: true,
    noPointXpReversalLoss: true
  };
  return { request, trustedMainEvidence, controlPlane, dataPlane };
}
function checkNoAuthority(r) {
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.blockers));
  assert.equal(r.executionState, 'nonlive_sql_review_only');
  for (const field of [
    'ownerAuthenticatedInReality',
    'independentExternalControlDbConnected',
    'primaryCasActuallyCommitted',
    'spentTombstonePersisted',
    'dataPlaneFenceActuallyInstalled',
    'privilegedPathsActuallyBlocked',
    'backupRestoredInReality',
    'actualStagingCommitVerified',
    'mayAccessSecrets',
    'mayQueryDb',
    'mayExecuteSql',
    'mayWriteDb',
    'mayRunStaging',
    'mayPostGithubClaim',
    'mayModifyProduction',
    'mayMergeMain',
    'mayDeploy'
  ])
    assert.equal(r[field], false, field);
}
const preview = (p) => buildPoint10xPostgresReviewAdapter(p);
const blocked = (r, reason) => {
  assert.ok(
    r.blockers.includes(reason),
    r.status + ' missing ' + reason + ' got: ' + r.blockers.join(',')
  );
  assert.equal(r.status, 'HOLD_INVALID_PG_REVIEW_INPUT');
  checkNoAuthority(r);
};
test('exact source contracts reused, not recreated', () => {
  assert.deepEqual(
    Object.keys(fixture().request).sort(),
    [...REQUEST_FIELDS].sort()
  );
  assert.equal(RECOVERY_WRITER_CLASSES.length, 9);
  assert.equal(RECOVERY_RELATIONS.length, 5);
  assert.equal(PG_REQUIRED_CATALOG_ROUTES.length, 5);
  assert.equal(PG_REVIEW_BLOCKERS.length, 9);
  assert.ok(POSTGRES_REVIEW_DOCUMENT.startsWith('docs/plans/'));
  assert.notEqual(STAGING_PROJECT, PRODUCTION_PROJECT);
});
test('review adapter produces immutable steps but cannot run SQL', () => {
  const r = preview(fixture());
  assert.equal(r.status, 'PG_ADAPTER_REVIEWABLE_BUT_NOT_EXECUTABLE');
  assert.equal(r.blockers.length, 0);
  assert.equal(r.noSqlExecutionEntrypoint, true);
  assert.equal(r.noRawSqlOrCredentialsInAdapter, true);
  assert.equal(r.noDistributedAtomicCommitAssumed, true);
  assert.equal(r.controlReview.length, 9);
  assert.equal(r.stagingReview.length, 9);
  assert.deepEqual(
    r.controlReview.map((x) => x.step),
    PG_CONTROL_STEPS
  );
  assert.deepEqual(
    r.stagingReview.map((x) => x.step),
    PG_DATA_PLANE_STEPS
  );
  assert.ok(Object.isFrozen(r.controlReview));
  assert.ok(Object.isFrozen(r.stagingReview));
  assert.equal(r.scopeModeWhenProvided.scope, ATOMIC_PROOF_SCOPE);
  assert.equal(r.stillBlockedOnRealSecurityReview, PG_REVIEW_BLOCKERS);
  checkNoAuthority(r);
});
test('all flags true are explicitly self-assertions rather than real proof', () => {
  const r = preview(fixture());
  assert.equal(r.ownerAuthenticatedInReality, false);
  assert.equal(r.primaryCasActuallyCommitted, false);
  assert.equal(r.dataPlaneFenceActuallyInstalled, false);
  assert.equal(r.canExecuteSql, undefined);
  checkNoAuthority(r);
});
test('distinct persist scope still cannot run Staging', () => {
  const p = fixture();
  p.request.scope = ATOMIC_WRITE_SCOPE;
  p.request.mode = APPROVAL_MODES.persist;
  p.trustedMainEvidence.scope = ATOMIC_WRITE_SCOPE;
  p.trustedMainEvidence.mode = APPROVAL_MODES.persist;
  const r = preview(p);
  assert.equal(r.status, 'PG_ADAPTER_REVIEWABLE_BUT_NOT_EXECUTABLE');
  checkNoAuthority(r);
});
test('legacy rollback-only scope cannot authorize the new adapter', () => {
  const p = fixture();
  p.request.scope = 'reader-reward-beta-point-10x-staging';
  blocked(preview(p), 'invalid_exact_staging_request');
});
test('persist scope combined with rollback mode is denied', () => {
  const p = fixture();
  p.request.scope = ATOMIC_WRITE_SCOPE;
  blocked(preview(p), 'invalid_exact_staging_request');
});
test('Production project explicitly forbidden', () => {
  const p = fixture();
  p.request.stagingRef = PRODUCTION_PROJECT;
  blocked(preview(p), 'invalid_exact_staging_request');
});
test('missing fixture cannot grant anything', () => {
  const r = preview();
  assert.ok(r.blockers.length >= 4);
  checkNoAuthority(r);
});
const tamperRequest = [
  ['mainSha', '0'.repeat(40)],
  ['candidateSha', '0'.repeat(40)],
  ['operationId', 'short'],
  ['sourceSnapshotSha256', 'invalid'],
  ['markerSqlSha256', 'x'.repeat(64)],
  ['legacyRpcSha256', 'x'.repeat(64)],
  ['candidateRpcSha256', 'x'.repeat(64)],
  ['mode', 'invalid']
];
for (const [k, v] of tamperRequest)
  test('tampered pinned request rejected: ' + k, () => {
    const p = fixture();
    p.request[k] = v;
    blocked(
      preview(p),
      ['mainSha', 'candidateSha'].includes(k)
        ? 'request_head_scope_or_target_mismatch'
        : 'invalid_exact_staging_request'
    );
  });
test('extra unreviewed request field rejected', () => {
  const p = fixture();
  p.request.force = 'true';
  blocked(preview(p), 'invalid_exact_staging_request');
});
const ownerFlags = [
  'authorActorMatches',
  'triggeringActorMatches',
  'issueHistoryFullyFetched',
  'verifiedByTrustedMainFixture'
];
for (const field of ownerFlags)
  test('missing trusted-main GitHub OWNER check denied: ' + field, () => {
    const p = fixture();
    p.trustedMainEvidence[field] = false;
    blocked(preview(p), 'owner_event_and_full_history_not_authenticated');
  });
const ownerFields = [
  ['owner', 'forged-owner'],
  ['issueNumber', 42],
  ['ownerAssociation', 'COLLABORATOR'],
  ['commentId', 0],
  ['canonicalCommentId', 9032],
  ['runId', 0]
];
for (const [field, val] of ownerFields)
  test('untrusted OWNER detail denied: ' + field, () => {
    const p = fixture();
    p.trustedMainEvidence[field] = val;
    blocked(preview(p), 'owner_event_and_full_history_not_authenticated');
  });
for (const [field, val] of [
  ['scope', 'wrong-scope'],
  ['mode', APPROVAL_MODES.persist],
  ['mainSha', 'e'.repeat(40)],
  ['candidateSha', 'e'.repeat(40)],
  ['projectRef', PRODUCTION_PROJECT]
])
  test('unmatched identity field denied: ' + field, () => {
    const p = fixture();
    p.trustedMainEvidence[field] = val;
    blocked(preview(p), 'request_head_scope_or_target_mismatch');
  });
for (const field of [
  'secretsOpened',
  'githubClaimAlreadyPosted',
  'approvalPreviouslySpent'
])
  test('no pre-CAS secret/claim/replay allowed: ' + field, () => {
    const p = fixture();
    p.trustedMainEvidence[field] = true;
    blocked(preview(p), 'secret_or_claim_before_durable_primary_cas');
  });
for (const field of ['expectedDomainVersion', 'expectedDomainEpoch'])
  test('negative expected DB version/epoch refused: ' + field, () => {
    const p = fixture();
    p.trustedMainEvidence[field] = -1;
    blocked(preview(p), 'invalid_expected_version_epoch_or_run');
  });
const controlFlags = [
  'separateFromStagingAndProduction',
  'serializableSingleTransaction',
  'lockDomainRowForUpdate',
  'spentCommentUnique',
  'spentOperationUnique',
  'spentScopeHeadUnique',
  'persistEpochAndSpendTogether',
  'conditionalNoConcurrentActiveClaim',
  'readOnlyPrimaryRequeryOnLostAck',
  'immutableSpentTombstones',
  'strictPrivateSchemaOwnership',
  'noPublicOrServiceRoleGrant',
  'sharedMutationDomainAcrossOldAndNew',
  'stagingRestoreCannotDecreaseAuthoritativeEpoch',
  'controlPlaneFailureHoldsAllMutations',
  'noAutomaticLeaseExpiryRelease',
  'githubIssueIsSecondaryAudit'
];
for (const field of controlFlags)
  test('control-plane requirement cannot be skipped: ' + field, () => {
    const p = fixture();
    p.controlPlane[field] = false;
    blocked(preview(p), 'control_design_missing:' + field);
  });
for (const [k, v] of [
  ['domain', 'github-concurrency-only'],
  ['primaryDomainVersion', 8],
  ['primaryDomainEpoch', 11]
])
  test('primary CAS version or domain drift rejected: ' + k, () => {
    const p = fixture();
    p.controlPlane[k] = v;
    blocked(preview(p), 'control_domain_epoch_version_mismatch');
  });
test('control schema cannot be public', () => {
  const p = fixture();
  p.controlPlane.controlSchema = 'public';
  blocked(preview(p), 'control_schema_role_not_pinned');
});
test('control writer DB role cannot be anonymous or service_role', () => {
  const p = fixture();
  p.controlPlane.controlDatabaseRole = 'service_role';
  blocked(preview(p), 'control_schema_role_not_pinned');
});
test('Staging fence epoch must advance the PRIMARY epoch', () => {
  const p = fixture();
  p.dataPlane.expectedFenceEpoch = 12;
  blocked(preview(p), 'staging_fence_epoch_not_linked_to_primary');
});
test('wrong mutation domain cannot be adopted by Staging gate', () => {
  const p = fixture();
  p.dataPlane.domain = 'other';
  blocked(preview(p), 'staging_fence_epoch_not_linked_to_primary');
});
test('fencing cannot target Production', () => {
  const p = fixture();
  p.dataPlane.targetProject = PRODUCTION_PROJECT;
  blocked(preview(p), 'staging_target_identity_unverified');
});
test('missing one of nine writer classes fails closed', () => {
  const p = fixture();
  p.dataPlane.writers.pop();
  blocked(preview(p), 'writer_registry_incomplete_or_unreviewed');
});
test('duplicate writer class fails closed', () => {
  const p = fixture();
  p.dataPlane.writers[0] = { ...p.dataPlane.writers[1] };
  blocked(preview(p), 'writer_registry_incomplete_or_unreviewed');
});
test('unreviewed writer class fails closed', () => {
  const p = fixture();
  p.dataPlane.writers[0].kind = 'new-writer';
  blocked(preview(p), 'writer_registry_incomplete_or_unreviewed');
});
for (const kind of RECOVERY_WRITER_CLASSES)
  test('every writer requires DB proof: ' + kind, () => {
    const p = fixture();
    p.dataPlane.writers.find((w) => w.kind === kind).oldEpochRejectedByDb =
      false;
    blocked(preview(p), 'writer_not_db_fenced_or_drained:' + kind);
  });
for (const field of [
  'admissionClosed',
  'oldEpochRejectedByDb',
  'dbEnforcementCatalogChecked'
])
  test('writer cannot skip fence flag: ' + field, () => {
    const p = fixture();
    p.dataPlane.writers[0][field] = false;
    blocked(
      preview(p),
      'writer_not_db_fenced_or_drained:' + RECOVERY_WRITER_CLASSES[0]
    );
  });
for (const field of ['inflight', 'retry', 'queued', 'outbox', 'unacked'])
  test('writer inflight or retry cannot survive freeze: ' + field, () => {
    const p = fixture();
    p.dataPlane.writers[0][field] = 1;
    blocked(
      preview(p),
      'writer_not_db_fenced_or_drained:' + RECOVERY_WRITER_CLASSES[0]
    );
  });
test('privileged inventory omission is fatal', () => {
  const p = fixture();
  p.dataPlane.privileged.pop();
  blocked(preview(p), 'privileged_route_registry_incomplete');
});
for (const path of PG_REQUIRED_CATALOG_ROUTES)
  test('privileged bypass denial is mandatory: ' + path, () => {
    const p = fixture();
    p.dataPlane.privileged.find(
      (q) => q.path === path
    ).bypassImpossibleForAffectedActor = false;
    blocked(preview(p), 'unfenced_privileged_route:' + path);
  });
for (const field of [
  'revokedOrFencedAtDatabase',
  'bypassImpossibleForAffectedActor',
  'catalogFingerprintChecked'
])
  test('service_role catalog cannot skip gate: ' + field, () => {
    const p = fixture();
    p.dataPlane.privileged[0][field] = false;
    blocked(
      preview(p),
      'unfenced_privileged_route:' + PG_REQUIRED_CATALOG_ROUTES[0]
    );
  });
test('missing protected XP relation disallows activation', () => {
  const p = fixture();
  p.dataPlane.relations.shift();
  blocked(preview(p), 'protected_relation_list_incomplete');
});
for (const field of [
  'dmlInsertDeniedWhenFrozen',
  'dmlUpdateDeniedWhenFrozen',
  'dmlDeleteDeniedWhenFrozen',
  'truncateDeniedWhenFrozen',
  'ownershipAclTriggersVerified'
])
  test('DML or truncate bypass refused: ' + field, () => {
    const p = fixture();
    p.dataPlane.relations[0][field] = false;
    blocked(
      preview(p),
      'relation_dml_or_truncate_bypass:' + RECOVERY_RELATIONS[0]
    );
  });
const globalDbFlags = [
  'legacyRpcCannotBypassFreeze',
  'noUnreviewedOwnerOrSuperuserPath',
  'noForgedSessionGucAsAuthority',
  'fenceSurvivesStagingRestore',
  'allWritersUseSamePrimaryEpoch',
  'fenceHeldThroughUncertainCommit',
  'restoreIndependentOfLiveStaging',
  'noPointXpReversalLoss'
];
for (const field of globalDbFlags)
  test('missing global DB proof refuses preview: ' + field, () => {
    const p = fixture();
    p.dataPlane[field] = false;
    blocked(preview(p), 'db_enforcement_not_proven:' + field);
  });
for (const [state, expected] of [
  ['COMMIT_UNKNOWN', true],
  ['CRASH_BEFORE_ACK', true],
  ['CAS_TIMEOUT', true]
])
  test('unknown CAS acknowledgement holds without retry: ' + state, () => {
    const r = reviewLostPostgresCasAcknowledgement({
      journalState: state,
      freshPrimaryReadback: 'INDEPENDENTLY_VERIFIED_SPENT_UNRELEASED',
      stageFence: 'HELD_UNTIL_MANUAL_RECONCILIATION'
    });
    assert.equal(r.status, 'HOLD_ACK_UNKNOWN_NO_RETRY');
    assert.equal(r.blockers.length, 0);
    assert.equal(r.neverReplayOperationId, expected);
    assert.equal(r.neverReclaimSpentApproval, true);
    assert.equal(r.neverResumeWriters, true);
    checkNoAuthority(r);
  });
test('unrecognized ack cannot be accepted', () => {
  const r = reviewLostPostgresCasAcknowledgement({ journalState: 'success' });
  assert.ok(r.blockers.includes('invalid_unknown_ack_scenario'));
  checkNoAuthority(r);
});
test('no independent primary readback blocks unknown ack', () => {
  const r = reviewLostPostgresCasAcknowledgement({
    journalState: 'COMMIT_UNKNOWN',
    freshPrimaryReadback: 'GITHUB_COMMENT_ONLY',
    stageFence: 'HELD_UNTIL_MANUAL_RECONCILIATION'
  });
  assert.ok(r.blockers.includes('primary_requery_missing_or_not_spent'));
  checkNoAuthority(r);
});
test('no Staging fence blocks unknown ack resolution', () => {
  const r = reviewLostPostgresCasAcknowledgement({
    journalState: 'CAS_TIMEOUT',
    freshPrimaryReadback: 'INDEPENDENTLY_VERIFIED_SPENT_UNRELEASED',
    stageFence: 'RELEASED_ON_TIMEOUT'
  });
  assert.ok(r.blockers.includes('staging_db_fence_not_held'));
  checkNoAuthority(r);
});
test('SQL candidate is review-only document, not a migration', () => {
  assert.ok(POSTGRES_REVIEW_DOCUMENT.startsWith('docs/plans/'));
  const md = readFileSync(
    fileURLToPath(new URL('../' + POSTGRES_REVIEW_DOCUMENT, import.meta.url)),
    'utf8'
  );
  assert.match(md, /REVIEW ONLY/u);
  assert.match(md, /NO-GO/u);
  assert.match(md, /FOR UPDATE/u);
  assert.match(md, /UNIQUE \(/u);
  assert.match(md, /SERIALIZABLE/u);
  assert.match(md, /service_role/u);
  assert.match(md, /RETURNING/u);
  assert.match(md, /ROLLBACK/u);
  assert.match(md, /SQLSTATE/u);
  assert.match(md, /TRUNCATE/u);
  assert.match(md, /fencing_epoch/u);
  assert.match(md, /SECURITY DEFINER/u);
});
