import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  OWNER_LOGIN,
  REPO,
  ISSUE_TITLE,
  REQUEST,
  CLAIMED,
  CONSUMED,
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  SOURCE_RPC_SHA256,
  FIXED_CANDIDATE_RPC_SHA256,
  inspectScoutAtomicOwnerRequest
} from '../scripts/scout-point10x-atomic-staging-plan.mjs';
import {
  MARKER_SQL_SHA256,
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import {
  LEDGER_PHASES,
  TERMINAL_OUTCOMES,
  CLAIM_PRECONDITIONS,
  RECOVERY_PRECONDITIONS,
  inspectScoutAtomicOneShotLedger,
  quoteScoutAtomicClaimTransition,
  quoteScoutAtomicConsumeTransition,
  quoteScoutAtomicRestoreProof
} from '../scripts/scout-point10x-atomic-one-shot-ledger.mjs';

const M = 'a'.repeat(40),
  H = 'b'.repeat(40),
  D = 'c'.repeat(64);
const newReq = () => ({
  scope: ATOMIC_PROOF_SCOPE,
  mode: APPROVAL_MODES.proof,
  mainSha: M,
  candidateSha: H,
  stagingRef: STAGING_PROJECT,
  operationId: 'point10x-atomic-20261105-a',
  sourceSnapshotSha256: D,
  markerSqlSha256: MARKER_SQL_SHA256,
  legacyRpcSha256: SOURCE_RPC_SHA256,
  candidateRpcSha256: FIXED_CANDIDATE_RPC_SHA256
});
const gateway = () =>
  inspectScoutAtomicOwnerRequest({
    repository: REPO,
    issue: { number: 294, title: ISSUE_TITLE, user: { login: OWNER_LOGIN } },
    comment: {
      id: 98765,
      user: { login: OWNER_LOGIN },
      author_association: 'OWNER',
      body: REQUEST + JSON.stringify(newReq())
    },
    actor: OWNER_LOGIN,
    triggeringActor: OWNER_LOGIN,
    currentMainSha: M,
    candidatePr: { headSha: H, baseSha: M, draft: true, merged: false },
    allIssueComments: [],
    allPagesFetched: true,
    trustedMainWorkflowReviewed: true
  });
const claim = () => ({
  requestCommentId: 98765,
  operationId: newReq().operationId,
  scope: ATOMIC_PROOF_SCOPE,
  mode: APPROVAL_MODES.proof,
  mainSha: M,
  candidateSha: H,
  runId: 987
});
const consumed = (result = 'failure') => ({ ...claim(), result });
const history = (prefix, payload, user = OWNER_LOGIN, id = 120000) => ({
  id,
  user: { login: user },
  body: prefix + JSON.stringify(payload)
});
const inspect = (change = {}) =>
  inspectScoutAtomicOneShotLedger({
    requestReview: gateway(),
    comments: [],
    allPagesFetched: true,
    repository: REPO,
    trustedMainOnly: true,
    serializedForScope: true,
    candidateHeadStillCurrent: true,
    currentMainSha: M,
    ...change
  });
const consumeReview = (change = {}) =>
  quoteScoutAtomicConsumeTransition({
    requestReview: gateway(),
    claimRecord: { commentId: 1234, ...claim() },
    terminalOutcome: 'success',
    allPagesFetched: true,
    ...change
  });
const restore = (change = {}) =>
  quoteScoutAtomicRestoreProof({
    backupStatus: 'complete_independently_verified',
    restoreStatus: 'independent_restore_complete',
    backupDigest: D,
    restoredDigest: D,
    aclTriggerRlsParity: true,
    originalUnit: '1pt_per_yen',
    noNewValidEvents: true,
    commitStatus: 'not_committed',
    writerFenceMaintained: true,
    ...change
  });
const assertInert = (r) => {
  assert.equal(r.independentlyAuthenticated, false);
  assert.equal(r.ownerApprovalRegistered, false);
  assert.equal(r.ledgerClaimPosted, false);
  assert.equal(r.ledgerConsumedPosted, false);
  for (const name of [
    'mayUseStagingSecrets',
    'mayExecuteSql',
    'mayRunStaging',
    'mayChangeProduction',
    'mayCreateMarker',
    'mayAlterSecurityDefiner',
    'mayUnlockWriters',
    'mayMergeMain',
    'mayDeploy',
    'mayGrantApproval'
  ])
    assert.equal(r[name], false, name);
  assert.equal(r.proofType, 'non_authoritative_offline_design');
  assert.equal(Object.isFrozen(r), true);
};

test('baseline owner request is reviewable but not authority', () => {
  const g = gateway();
  assert.equal(g.status, 'canonical_request_reviewed_not_authenticated');
  assert.equal(g.independentlyAuthorized, false);
});
test('new atomic scopes remain separate from legacy scope', () => {
  assert.notEqual(ATOMIC_PROOF_SCOPE, ATOMIC_WRITE_SCOPE);
  assert.notEqual(APPROVAL_MODES.proof, APPROVAL_MODES.persist);
});
test('phase and terminal outcome vocabulary covers cancellation and unknown', () => {
  assert.deepEqual(LEDGER_PHASES, [
    'UNSEEN',
    'REQUEST_REVIEWED',
    'CLAIM_UNCONFIRMED',
    'CLAIMED',
    'CONSUMED',
    'DENIED'
  ]);
  assert.ok(TERMINAL_OUTCOMES.includes('cancelled'));
  assert.ok(TERMINAL_OUTCOMES.includes('uncertain'));
});
test('a full clean ledger scan is a hypothesis, NOT owner-authenticated approval', () => {
  const x = inspect();
  assert.equal(x.status, 'unclaimed_request_hypothesis_only');
  assert.equal(x.observedPhase, 'REQUEST_REVIEWED');
  assert.equal(x.githubIssueCommentsAreNotAnAtomicCAS, true);
  assert.equal(x.claimNotYetWritten, true);
  assertInert(x);
});
const inventoryDenied = [
  [
    'request missing',
    { requestReview: null },
    'request_not_reviewed_or_comment_id_invalid'
  ],
  [
    'repository spoof',
    { repository: 'attacker/novelrise' },
    'trusted_main_and_repository_not_proven'
  ],
  [
    'trusted main absent',
    { trustedMainOnly: false },
    'trusted_main_and_repository_not_proven'
  ],
  [
    'Issue not fully fetched',
    { allPagesFetched: false },
    'incomplete_github_issue_history'
  ],
  ['history not array', { comments: null }, 'incomplete_github_issue_history'],
  [
    'no serialized writer lock',
    { serializedForScope: false },
    'atomic_concurrent_claim_serialization_unproven'
  ],
  [
    'candidate head drift',
    { candidateHeadStillCurrent: false },
    'fresh_main_or_candidate_head_unproven'
  ],
  [
    'wrong current main',
    { currentMainSha: 'f'.repeat(40) },
    'fresh_main_or_candidate_head_unproven'
  ],
  [
    'invalid current main',
    { currentMainSha: 'unknown' },
    'fresh_main_or_candidate_head_unproven'
  ],
  [
    'empty or invalid comment',
    { comments: [{}] },
    'invalid_issue_history_comment'
  ],
  [
    'duplicate comment ID',
    {
      comments: [
        { id: 1, user: { login: OWNER_LOGIN }, body: 'normal' },
        { id: 1, user: { login: OWNER_LOGIN }, body: 'normal again' }
      ]
    },
    'duplicated_issue_comment_id'
  ]
];
for (const [name, change, expected] of inventoryDenied) {
  test('ledger refuses ' + name, () => {
    const r = inspect(change);
    assert.equal(r.status, 'one_shot_ledger_hold', name);
    assert.ok(r.blockers.includes(expected), name);
    assertInert(r);
  });
}
test('existing CLAIMED for the same request is always consumed', () => {
  const r = inspect({ comments: [history(CLAIMED, claim())] });
  assert.equal(r.status, 'one_shot_ledger_hold');
  assert.ok(r.blockers.includes('already_claimed_or_consumed_request'));
  assert.equal(r.historicalClaims, 1);
  assertInert(r);
});
test('existing CONSUMED matching same request cannot be recycled', () => {
  const r = inspect({
    comments: [
      history(CLAIMED, claim(), OWNER_LOGIN, 1001),
      history(CONSUMED, consumed(), OWNER_LOGIN, 1002)
    ]
  });
  assert.ok(r.blockers.includes('already_claimed_or_consumed_request'));
  assert.equal(r.historicalConsumed, 1);
  assertInert(r);
});
test('all terminal outcomes are spent even if failed or cancelled', () => {
  for (const end of TERMINAL_OUTCOMES) {
    const r = inspect({
      comments: [
        history(CLAIMED, claim(), OWNER_LOGIN, 31),
        history(CONSUMED, consumed(end), OWNER_LOGIN, 32)
      ]
    });
    assert.ok(r.blockers.includes('already_claimed_or_consumed_request'), end);
    assertInert(r);
  }
});
test('same operation ID with another comment is a replay', () => {
  const s = { ...claim(), requestCommentId: 200 };
  const r = inspect({ comments: [history(CLAIMED, s)] });
  assert.ok(r.blockers.includes('already_claimed_or_consumed_request'));
});
test('same scope and candidate head with another operation is a replay', () => {
  const s = {
    ...claim(),
    operationId: 'point10x-atomic-other',
    requestCommentId: 200
  };
  const r = inspect({ comments: [history(CLAIMED, s)] });
  assert.ok(r.blockers.includes('already_claimed_or_consumed_request'));
});
test('a claim for a distinct scope AND a distinct head does not authorize this request', () => {
  const s = {
    ...claim(),
    operationId: 'point10x-other',
    requestCommentId: 200,
    candidateSha: 'd'.repeat(40),
    scope: ATOMIC_WRITE_SCOPE,
    mode: APPROVAL_MODES.persist
  };
  const r = inspect({ comments: [history(CLAIMED, s)] });
  assert.equal(r.status, 'unclaimed_request_hypothesis_only');
  assert.equal(r.ledgerClaimPosted, false);
});
test('duplicate CLAIMED marker for any request is rejected', () => {
  const s = {
    ...claim(),
    operationId: 'point10x-other',
    requestCommentId: 200,
    candidateSha: 'd'.repeat(40),
    scope: ATOMIC_WRITE_SCOPE,
    mode: APPROVAL_MODES.persist
  };
  const r = inspect({
    comments: [
      history(CLAIMED, s, OWNER_LOGIN, 10),
      history(CLAIMED, s, OWNER_LOGIN, 11)
    ]
  });
  assert.ok(r.blockers.includes('duplicated_claim_record'));
});
test('duplicate CONSUMED for any operation is rejected', () => {
  const s = {
    ...consumed(),
    operationId: 'point10x-other',
    requestCommentId: 200,
    candidateSha: 'd'.repeat(40),
    scope: ATOMIC_WRITE_SCOPE,
    mode: APPROVAL_MODES.persist
  };
  const c = { ...s };
  delete c.result;
  const r = inspect({
    comments: [
      history(CLAIMED, c, OWNER_LOGIN, 21),
      history(CONSUMED, s, OWNER_LOGIN, 22),
      history(CONSUMED, s, OWNER_LOGIN, 23)
    ]
  });
  assert.ok(r.blockers.includes('duplicated_consumed_record'));
});
test('CONSUMED without corresponding CLAIMED is blocked', () => {
  const r = inspect({ comments: [history(CONSUMED, consumed())] });
  assert.ok(r.blockers.includes('consumed_without_corresponding_claim'));
});
test('untrusted user may not forge CLAIMED ledger rows', () => {
  const r = inspect({ comments: [history(CLAIMED, claim(), 'attacker')] });
  assert.ok(r.blockers.includes('untrusted_claim_ledger_writer'));
});
test('noncanonical JSON and duplicate keys in CLAIMED are blocked', () => {
  const bad = CLAIMED + JSON.stringify({ ...claim(), extra: 1 });
  const weird = CLAIMED + JSON.stringify(claim(), null, 2);
  for (const body of [bad, weird, CLAIMED + '{}', CLAIMED + 'notjson']) {
    const r = inspect({
      comments: [{ id: 11, user: { login: OWNER_LOGIN }, body }]
    });
    assert.ok(r.blockers.includes('invalid_claim_or_consume_marker'));
  }
});
test('claim with incorrect mode and scope pair is blocked', () => {
  const r = inspect({
    comments: [history(CLAIMED, { ...claim(), mode: APPROVAL_MODES.persist })]
  });
  assert.ok(r.blockers.includes('unexpected_claimed_scope_mode'));
});
test('invalid run ID, comment ID, SHA fields in CLAIMED are blocked', () => {
  for (const edit of [
    { runId: 0 },
    { requestCommentId: 'xyz' },
    { mainSha: 'foo' },
    { candidateSha: 'foo' }
  ]) {
    const r = inspect({
      comments: [history(CLAIMED, { ...claim(), ...edit })]
    });
    assert.ok(r.blockers.includes('invalid_claim_or_consume_marker'));
  }
});
test('invalid CONSUMED result marker is blocked', () => {
  const s = { ...consumed(), result: 'retryable' };
  const r = inspect({ comments: [history(CONSUMED, s)] });
  assert.ok(r.blockers.includes('invalid_consumed_outcome'));
});
test('history with too many comments fails closed', () => {
  const r = inspect({
    comments: Array.from({ length: 10001 }, () => ({ id: 1, body: 'hi' }))
  });
  assert.ok(r.blockers.includes('incomplete_github_issue_history'));
});
test('claim transition never posts a GitHub issue comment', () => {
  const r = quoteScoutAtomicClaimTransition({
    ledgerReview: inspect(),
    requestReview: gateway(),
    activeTrustedMainLock: true
  });
  assert.equal(r.status, 'claim_boundary_design_only');
  assert.equal(r.candidatePhase, 'CLAIM_UNCONFIRMED');
  assert.equal(r.claimCouldNotBeActuallyWritten, true);
  assertInert(r);
});
test('claim transition remains non-executable even after hypothetical re-read', () => {
  const r = quoteScoutAtomicClaimTransition({
    ledgerReview: inspect(),
    requestReview: gateway(),
    activeTrustedMainLock: true,
    claimCommentId: 733,
    claimPostObserved: true,
    claimReReadObserved: true
  });
  assert.equal(r.status, 'claim_boundary_design_only');
  assert.equal(r.candidatePhase, 'CLAIMED');
  assert.equal(r.ledgerClaimPosted, false);
  assertInert(r);
});
const claimHolds = [
  [
    'missing owner request',
    { requestReview: null },
    'owner_request_not_independently_authenticated'
  ],
  [
    'missing complete ledger',
    { ledgerReview: null },
    'unclaimed_request_not_established'
  ],
  [
    'missing lock',
    { activeTrustedMainLock: false },
    'no_durable_serialized_owner_claim_lock'
  ],
  [
    'secrets read before claim',
    { stagingSecretsAlreadyRead: true },
    'staging_secret_accessed_before_claim'
  ],
  [
    'job cancelled',
    { runnerCanceled: true },
    'cancelled_request_cannot_be_retried'
  ],
  [
    'claim ID without post/re-read',
    { claimCommentId: 2 },
    'claim_write_or_reread_unconfirmed'
  ],
  [
    'claim post without ID',
    { claimPostObserved: true },
    'claim_evidence_without_comment_id'
  ],
  [
    'claim read without post',
    { claimCommentId: 4, claimReReadObserved: true },
    'claim_write_or_reread_unconfirmed'
  ]
];
for (const [name, change, expected] of claimHolds) {
  test('claim transition rejects ' + name, () => {
    const r = quoteScoutAtomicClaimTransition({
      ledgerReview: inspect(),
      requestReview: gateway(),
      activeTrustedMainLock: true,
      ...change
    });
    assert.equal(r.status, 'atomic_claim_boundary_hold');
    assert.ok(r.blockers.includes(expected), name);
    assertInert(r);
  });
}
test('CONSUMED draft on success is never published', () => {
  const r = quoteScoutAtomicConsumeTransition({
    requestReview: gateway(),
    claimRecord: { commentId: 2, ...claim() },
    terminalOutcome: 'success',
    allPagesFetched: true
  });
  assert.equal(r.status, 'consumed_record_draft_only');
  assert.equal(r.neverRetrySameOwnerRequest, true);
  assert.equal(r.consumedMarkerWasNotPublished, true);
  assertInert(r);
});
test('all terminal outcomes consume the same approval once', () => {
  for (const terminalOutcome of TERMINAL_OUTCOMES.filter(
    (x) => x !== 'uncertain'
  )) {
    const r = quoteScoutAtomicConsumeTransition({
      requestReview: gateway(),
      claimRecord: { commentId: 2, ...claim() },
      terminalOutcome,
      allPagesFetched: true
    });
    assert.equal(r.status, 'consumed_record_draft_only', terminalOutcome);
    assert.equal(r.shouldConsumeRegardlessOfSuccess, true);
    assertInert(r);
  }
});
test('uncertain commit cannot become consumed without read-only requery', () => {
  const r = consumeReview({ terminalOutcome: 'uncertain' });
  assert.ok(
    r.blockers.includes('ambiguous_commit_must_be_requeried_without_mutation')
  );
  assertInert(r);
});
test('after hypothetical read-only requery uncertain remains non-executable', () => {
  const r = consumeReview({
    terminalOutcome: 'uncertain',
    postCommitLedgerVerified: true
  });
  assert.equal(r.status, 'consumed_record_draft_only');
  assert.equal(r.uncertainOutcomeMustNotReexecute, true);
  assertInert(r);
});
const consumeHolds = [
  ['request absent', { requestReview: null }, 'request_not_reviewed'],
  ['claim absent', { claimRecord: null }, 'claim_identity_or_sha_mismatch'],
  [
    'wrong request comment',
    { claimRecord: { commentId: 2, ...claim(), requestCommentId: 111 } },
    'claim_identity_or_sha_mismatch'
  ],
  [
    'different SHA',
    { claimRecord: { commentId: 2, ...claim(), mainSha: 'd'.repeat(40) } },
    'claim_identity_or_sha_mismatch'
  ],
  [
    'different scope',
    { claimRecord: { commentId: 2, ...claim(), scope: ATOMIC_WRITE_SCOPE } },
    'claim_identity_or_sha_mismatch'
  ],
  [
    'wrong mode',
    { claimRecord: { commentId: 2, ...claim(), mode: APPROVAL_MODES.persist } },
    'claim_identity_or_sha_mismatch'
  ],
  ['invalid result', { terminalOutcome: 'auto_retry' }, 'invalid_final_result'],
  [
    'history not freshly read',
    { allPagesFetched: false },
    'fresh_github_history_not_verified'
  ]
];
for (const [name, change, expected] of consumeHolds) {
  test('consume transition rejects ' + name, () => {
    const r = consumeReview(change);
    assert.equal(r.status, 'atomic_consumption_review_hold');
    assert.ok(r.blockers.includes(expected), name);
    assertInert(r);
  });
}
test('backup restore proof is never actual Staging proof', () => {
  const r = restore();
  assert.equal(r.status, 'restoration_evidence_self_reported_only');
  assert.equal(r.backupWasReallyRestored, false);
  assert.equal(r.mayRestoreStaleBackup, false);
  assertInert(r);
});
const restoreHolds = [
  ['backup absent', { backupStatus: 'missing' }, 'backup_not_verified'],
  [
    'restore failed',
    { restoreStatus: 'error' },
    'restore_failed_or_unverified'
  ],
  [
    'source digest missing',
    { backupDigest: 'wrong' },
    'restored_full_rows_or_source_digest_mismatch'
  ],
  [
    'restored rows drift',
    { restoredDigest: 'd'.repeat(64) },
    'restored_full_rows_or_source_digest_mismatch'
  ],
  [
    'RPC/ACL/RLS drift',
    { aclTriggerRlsParity: false },
    'function_acl_trigger_rls_parity_unproven'
  ],
  ['wrong unit', { originalUnit: '10pt_per_yen' }, 'unexpected_source_unit'],
  [
    'writer fence released',
    { writerFenceMaintained: false },
    'writer_fence_unverified'
  ],
  ['unknown commit', { commitStatus: 'unknown' }, 'unknown_commit_resolution'],
  [
    'ambiguous commit',
    { commitStatus: 'ambiguous' },
    'ambiguous_commit_needs_independent_requery'
  ],
  [
    'new Point after commit',
    { commitStatus: 'committed', noNewValidEvents: false },
    'stale_backup_restore_would_erase_new_awards'
  ]
];
for (const [name, change, expected] of restoreHolds) {
  test('restore proof refuses ' + name, () => {
    const r = restore(change);
    assert.equal(r.status, 'restore_proof_hold');
    assert.ok(r.blockers.includes(expected), name);
    assertInert(r);
  });
}
test('commit with no new events still requires a separate real recovery gate', () => {
  const r = restore({ commitStatus: 'committed', noNewValidEvents: true });
  assert.equal(r.status, 'restoration_evidence_self_reported_only');
  assert.equal(r.mayRestoreStaleBackup, false);
  assertInert(r);
});
test('CLAIMED posted before its own request comment is invalid', () => {
  const item = {
    ...claim(),
    operationId: 'other-op-valid-id-01',
    candidateSha: 'd'.repeat(40),
    requestCommentId: 98765
  };
  const r = inspect({ comments: [history(CLAIMED, item, OWNER_LOGIN, 90000)] });
  assert.ok(r.blockers.includes('claim_or_consume_before_request'));
  assert.equal(r.status, 'one_shot_ledger_hold');
  assertInert(r);
});
test('CONSUMED preceding its matching CLAIMED is invalid', () => {
  const item = {
    ...claim(),
    operationId: 'other-op-valid-id-01',
    candidateSha: 'd'.repeat(40),
    requestCommentId: 98765
  };
  const r = inspect({
    comments: [
      history(CONSUMED, { ...item, result: 'failure' }, OWNER_LOGIN, 120100),
      history(CLAIMED, item, OWNER_LOGIN, 120200)
    ]
  });
  assert.ok(r.blockers.includes('consumed_before_claim'));
  assert.equal(r.status, 'one_shot_ledger_hold');
  assertInert(r);
});
test('phase and precondition arrays are immutable', () => {
  for (const v of [
    LEDGER_PHASES,
    TERMINAL_OUTCOMES,
    CLAIM_PRECONDITIONS,
    RECOVERY_PRECONDITIONS
  ])
    assert.ok(Object.isFrozen(v));
  assert.ok(
    CLAIM_PRECONDITIONS.some((x) => x.includes('before_any_staging_secret'))
  );
  assert.ok(RECOVERY_PRECONDITIONS.some((x) => x.includes('independent')));
});
const blueprint = readFileSync(
  new URL(
    '../docs/plans/READER-REWARD-POINT10X-OWNER-LEDGER-INERT-WORKFLOW-20261105.yml',
    import.meta.url
  ),
  'utf8'
);
test('inert workflow template exists ONLY under docs/plans', () => {
  assert.ok(blueprint.startsWith('# NOVELIGHT beta Scout Point x10'));
  assert.match(blueprint, /NOT in \.github\/workflows/u);
});
test('template has empty trigger map and unconditional false job', () => {
  assert.match(blueprint, /^"on": \{\}$/mu);
  assert.match(blueprint, /^\s+if: \$\{\{ false \}\}$/mu);
  assert.doesNotMatch(blueprint, /^\s+workflow_dispatch\s*:/mu);
  assert.doesNotMatch(blueprint, /^\s+issue_comment\s*:/mu);
});
test('template has no staging/production credentials or DB commands', () => {
  assert.doesNotMatch(blueprint, /^\s+secrets\s*:/mu);
  assert.doesNotMatch(blueprint, /\$\{\{\s*secrets\./u);
  assert.doesNotMatch(blueprint, /^\s+run:\s*(?:psql|supabase|curl|gh)\b/mu);
});
test('template job grants only read-only repository permission', () => {
  assert.match(blueprint, /permissions:\s*\n\s+contents: read/mu);
  assert.doesNotMatch(blueprint, /^\s+(?:issues|actions|deployments): write/mu);
});
test('template concurrency never cancels a prior candidate run', () => {
  assert.match(blueprint, /cancel-in-progress: false/u);
  assert.match(blueprint, /novelight-issue294-staging/u);
});
test('staging target and production target are different and not used', () => {
  assert.notEqual(STAGING_PROJECT, PRODUCTION_PROJECT);
  assert.doesNotMatch(
    blueprint,
    /DB_CONNECTION_STRING|DATABASE_URL|API_KEY|PASSWORD=/u
  );
});
