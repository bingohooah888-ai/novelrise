import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNER_LOGIN,
  REPO,
  ISSUE_TITLE,
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  REQUEST,
  CLAIMED,
  CONSUMED,
  REQUEST_FIELDS,
  LEDGER_FIELDS,
  CONSUMED_FIELDS,
  FIXED_CANDIDATE_RPC_SHA256,
  SOURCE_RPC_SHA256,
  PLAN_STAGES,
  REQUIRED_STAGING_EVIDENCE,
  inspectScoutAtomicOwnerRequest,
  compileScoutAtomicStagingReviewPlan,
  quoteScoutAtomicFailureDisposition
} from '../scripts/scout-point10x-atomic-staging-plan.mjs';
import {
  MARKER_SQL_SHA256,
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';

const M = 'a'.repeat(40),
  H = 'b'.repeat(40),
  D = 'c'.repeat(64);
const request = (write = false) => ({
  scope: write ? ATOMIC_WRITE_SCOPE : ATOMIC_PROOF_SCOPE,
  mode: write ? APPROVAL_MODES.persist : APPROVAL_MODES.proof,
  mainSha: M,
  candidateSha: H,
  stagingRef: STAGING_PROJECT,
  operationId: 'point10x-atomic-20261105-a',
  sourceSnapshotSha256: D,
  markerSqlSha256: MARKER_SQL_SHA256,
  legacyRpcSha256: SOURCE_RPC_SHA256,
  candidateRpcSha256: FIXED_CANDIDATE_RPC_SHA256
});
const fixture = (write = false) => ({
  repository: REPO,
  issue: { number: 294, title: ISSUE_TITLE, user: { login: OWNER_LOGIN } },
  comment: {
    id: 98765,
    user: { login: OWNER_LOGIN },
    author_association: 'OWNER',
    body: REQUEST + JSON.stringify(request(write))
  },
  actor: OWNER_LOGIN,
  triggeringActor: OWNER_LOGIN,
  currentMainSha: M,
  candidatePr: { headSha: H, baseSha: M, draft: true, merged: false },
  allIssueComments: [],
  allPagesFetched: true,
  trustedMainWorkflowReviewed: true
});
const inspect = (change = {}, write = false) =>
  inspectScoutAtomicOwnerRequest({ ...fixture(write), ...change });
const block = (r) => {
  assert.equal(r.independentlyAuthorized, false);
  assert.equal(r.realRunStarted, false);
  assert.equal(r.approvalConsumed, false);
  for (const key of [
    'mayReadSecrets',
    'mayExecuteSql',
    'mayWriteStaging',
    'mayAlterDefiner',
    'mayCreateMarker',
    'mayPauseWriters',
    'mayWriteProduction',
    'mayMergeMain',
    'mayDeploy'
  ]) {
    assert.equal(r[key], false, key);
  }
};
const withRequest = (change = {}, write = false) => {
  const original = fixture(write),
    payload = { ...request(write), ...change };
  original.comment.body = REQUEST + JSON.stringify(payload);
  return inspect(original, write);
};
const manifest = () => ({
  markerSqlSha256: MARKER_SQL_SHA256,
  legacyRpcSha256: SOURCE_RPC_SHA256,
  candidateRpcSha256: FIXED_CANDIDATE_RPC_SHA256
});
const evidence = () =>
  Object.fromEntries(REQUIRED_STAGING_EVIDENCE.map((x) => [x, true]));
const plan = (change = {}) =>
  compileScoutAtomicStagingReviewPlan({
    ownerRequest: inspect({}, true),
    atomicContract: { status: 'all_claimed_evidence_still_not_authorization' },
    scope: ATOMIC_WRITE_SCOPE,
    mode: APPROVAL_MODES.persist,
    assetHashes: manifest(),
    stagingEvidence: evidence(),
    ...change
  });
const claimed = (write = false, changes = {}) => ({
  requestCommentId: 98765,
  operationId: request(write).operationId,
  scope: request(write).scope,
  mode: request(write).mode,
  mainSha: M,
  candidateSha: H,
  runId: 77,
  ...changes
});
const ledger = (prefix, payload, user = 'github-actions[bot]') => ({
  user: { login: user },
  body: prefix + JSON.stringify(payload)
});

test('proof and persistent have separate scope AND separate mode', () => {
  assert.notEqual(ATOMIC_PROOF_SCOPE, ATOMIC_WRITE_SCOPE);
  assert.notEqual(APPROVAL_MODES.proof, APPROVAL_MODES.persist);
  assert.equal(REPO, OWNER_LOGIN + '/novelrise');
});
test('request and claim have exact schema fields', () => {
  assert.deepEqual(Object.keys(request()), REQUEST_FIELDS);
  assert.equal(LEDGER_FIELDS.length, 7);
  assert.equal(CONSUMED_FIELDS.length, 8);
});
for (const write of [false, true]) {
  test(
    'canonical ' +
      (write ? 'persistent' : 'proof') +
      ' request only produces unauthenticated review',
    () => {
      const r = inspect({}, write);
      assert.equal(r.status, 'canonical_request_reviewed_not_authenticated');
      assert.equal(r.reviewedRequest.mode, request(write).mode);
      assert.equal(r.claimBeforeAnySecretAccess, true);
      block(r);
    }
  );
}
const issueCases = [
  [
    'wrong repository',
    { repository: 'bad/repo' },
    'wrong_issue_294_identity_or_type'
  ],
  [
    'wrong Issue number',
    {
      issue: { number: 188, title: ISSUE_TITLE, user: { login: OWNER_LOGIN } }
    },
    'wrong_issue_294_identity_or_type'
  ],
  [
    'wrong Issue title',
    { issue: { number: 294, title: 'other', user: { login: OWNER_LOGIN } } },
    'wrong_issue_294_identity_or_type'
  ],
  [
    'wrong Issue owner',
    { issue: { number: 294, title: ISSUE_TITLE, user: { login: 'bad' } } },
    'wrong_issue_294_identity_or_type'
  ],
  [
    'Issue is PR',
    { issue: { ...fixture().issue, pull_request: {} } },
    'wrong_issue_294_identity_or_type'
  ],
  [
    'actor spoof',
    { actor: 'bad' },
    'owner_comment_and_github_actor_not_authenticated'
  ],
  [
    'triggeringActor spoof',
    { triggeringActor: 'bad' },
    'owner_comment_and_github_actor_not_authenticated'
  ],
  [
    'comment user spoof',
    { comment: { ...fixture().comment, user: { login: 'bad' } } },
    'owner_comment_and_github_actor_not_authenticated'
  ],
  [
    'not OWNER association',
    { comment: { ...fixture().comment, author_association: 'MEMBER' } },
    'owner_comment_and_github_actor_not_authenticated'
  ],
  [
    'invalid comment ID',
    { comment: { ...fixture().comment, id: '123' } },
    'owner_comment_and_github_actor_not_authenticated'
  ],
  [
    'untrusted current main',
    { currentMainSha: 'd'.repeat(40) },
    'stale_or_wrong_main_candidate_head'
  ],
  [
    'stale PR head',
    { candidatePr: { ...fixture().candidatePr, headSha: 'e'.repeat(40) } },
    'stale_or_wrong_main_candidate_head'
  ],
  [
    'merged PR',
    { candidatePr: { ...fixture().candidatePr, merged: true } },
    'stale_or_wrong_main_candidate_head'
  ],
  [
    'non-Draft PR',
    { candidatePr: { ...fixture().candidatePr, draft: false } },
    'stale_or_wrong_main_candidate_head'
  ],
  [
    'main workflow absent',
    { trustedMainWorkflowReviewed: false },
    'trusted_main_workflow_unavailable_or_unreviewed'
  ],
  [
    'Issue comments incomplete',
    { allPagesFetched: false },
    'approval_history_not_complete'
  ],
  [
    'history missing',
    { allIssueComments: null },
    'approval_history_not_complete'
  ],
  [
    'invalid history row',
    { allIssueComments: [null] },
    'malformed_issue_comment_history'
  ]
];
for (const [name, change, expected] of issueCases) {
  test('default deny: ' + name, () => {
    const x = inspect(change);
    assert.ok(x.blockers.includes(expected));
    block(x);
  });
}
const payloadCases = [
  [
    'legacy rollback scope',
    { scope: 'reader-reward-beta-point-10x-staging', mode: 'rollback-only' },
    'wrong_atomic_scope_or_legacy_approval_reuse'
  ],
  [
    'cross-mode proof',
    { mode: APPROVAL_MODES.persist },
    'wrong_atomic_scope_or_legacy_approval_reuse'
  ],
  [
    'Production target',
    { stagingRef: PRODUCTION_PROJECT },
    'incorrect_staging_target'
  ],
  [
    'old snapshot digest missing',
    { sourceSnapshotSha256: null },
    'unreviewed_backup_marker_or_rpc_digest'
  ],
  [
    'marker SHA drift',
    { markerSqlSha256: 'e'.repeat(64) },
    'unreviewed_backup_marker_or_rpc_digest'
  ],
  [
    'definer source SHA drift',
    { legacyRpcSha256: 'e'.repeat(64) },
    'unreviewed_backup_marker_or_rpc_digest'
  ],
  [
    'definer candidate SHA drift',
    { candidateRpcSha256: 'e'.repeat(64) },
    'unreviewed_backup_marker_or_rpc_digest'
  ],
  ['unknown operation ID', { operationId: '../evil' }, 'invalid_operation_id'],
  ['too short operation ID', { operationId: 'x' }, 'invalid_operation_id']
];
for (const [name, change, expected] of payloadCases) {
  test('request rejects ' + name, () => {
    const x = withRequest(change);
    assert.ok(x.blockers.includes(expected));
    block(x);
  });
}
test('old scope cannot be paired with new persistent mode', () => {
  const x = withRequest({
    scope: 'reader-reward-beta-point-10x-staging',
    mode: APPROVAL_MODES.persist
  });
  assert.ok(x.blockers.includes('wrong_atomic_scope_or_legacy_approval_reuse'));
});
test('noncanonical JSON whitespace rejected', () => {
  const f = fixture();
  f.comment.body = REQUEST + JSON.stringify(request(), null, 2);
  assert.ok(
    inspect(f).blockers.includes(
      'invalid_noncanonical_or_duplicate_request_fields'
    )
  );
});
test('extra request field rejected', () => {
  const x = withRequest({ isOwner: true });
  assert.ok(
    x.blockers.includes('invalid_noncanonical_or_duplicate_request_fields')
  );
});
test('duplicate JSON key rejected', () => {
  const f = fixture();
  f.comment.body =
    REQUEST +
    JSON.stringify(request()).replace(
      /\}$/u,
      ',"scope":"' + ATOMIC_WRITE_SCOPE + '"}'
    );
  assert.ok(
    inspect(f).blockers.includes(
      'invalid_noncanonical_or_duplicate_request_fields'
    )
  );
});
const ledgerCases = [
  [
    'claimed request',
    CLAIMED,
    claimed(),
    OWNER_LOGIN,
    'claim_or_consumed_already_exists'
  ],
  [
    'consumed failure',
    CONSUMED,
    { ...claimed(), result: 'failure' },
    OWNER_LOGIN,
    'claim_or_consumed_already_exists'
  ],
  [
    'consumed cancellation',
    CONSUMED,
    { ...claimed(), result: 'cancelled' },
    OWNER_LOGIN,
    'claim_or_consumed_already_exists'
  ],
  [
    'different comment same operation',
    CLAIMED,
    claimed(false, { requestCommentId: 333 }),
    OWNER_LOGIN,
    'claim_or_consumed_already_exists'
  ],
  [
    'same head and scope another operation',
    CLAIMED,
    claimed(false, {
      requestCommentId: 333,
      operationId: 'point10x-atomic-other'
    }),
    OWNER_LOGIN,
    'claim_or_consumed_already_exists'
  ],
  [
    'attacker-authored claim',
    CLAIMED,
    claimed(),
    'attacker',
    'untrusted_actor_wrote_claim_ledger'
  ],
  [
    'malformed ledger',
    CLAIMED,
    {},
    OWNER_LOGIN,
    'noncanonical_or_malformed_owner_ledger'
  ]
];
for (const [name, prefix, payload, user, expected] of ledgerCases) {
  test('one-time ledger rejects ' + name, () => {
    const x = inspect({ allIssueComments: [ledger(prefix, payload, user)] });
    assert.ok(x.blockers.includes(expected), name);
    block(x);
  });
}
test('unrelated user discussion cannot forge a CLAIM', () => {
  const x = inspect({
    allIssueComments: [
      { body: 'ordinary issue discussion', user: { login: 'stranger' } }
    ]
  });
  assert.equal(x.status, 'canonical_request_reviewed_not_authenticated');
  block(x);
});
test('all-good caller-provided request never grants approval', () => {
  const x = inspect();
  assert.equal(x.approvalConsumed, false);
  block(x);
});
test('persistent plan has 17 ordered nonexecutable stages', () => {
  const x = plan();
  assert.equal(x.status, 'atomic_staging_review_plan_only');
  assert.deepEqual(
    x.immutableStages.map((z) => z.name),
    PLAN_STAGES
  );
  assert.equal(x.immutableStages.length, 17);
  assert.ok(x.immutableStages.every((z) => z.executableByThisModule === false));
  assert.equal(x.noRunningExecutableSqlProduced, true);
  block(x);
});
test('persistent plan never commits without independent trusted executor', () => {
  const x = plan();
  assert.equal(
    x.proposedTransactionDecision,
    'COMMIT_REQUIRES_NEW_TRUSTED_EXECUTOR_AND_OWNER'
  );
  assert.equal(
    x.persistentStagingRequiresIndependentlySignedOneUseApproval,
    true
  );
  block(x);
});
test('proof plan has unconditional rollback decision', () => {
  const x = compileScoutAtomicStagingReviewPlan({
    ownerRequest: inspect(),
    atomicContract: { status: 'all_claimed_evidence_still_not_authorization' },
    scope: ATOMIC_PROOF_SCOPE,
    mode: APPROVAL_MODES.proof,
    assetHashes: manifest(),
    stagingEvidence: evidence()
  });
  assert.equal(x.proposedTransactionDecision, 'ROLLBACK');
  assert.equal(
    x.immutableStages.find((z) => z.name === 'transaction_decision')
      .requiredBoundary,
    'ALWAYS_ROLLBACK'
  );
  block(x);
});
const planCases = [
  ['missing request', { ownerRequest: null }, 'owner_request_not_reviewed'],
  [
    'missing atomic predecessor contract',
    { atomicContract: null },
    'atomic_dependency_contract_incomplete'
  ],
  [
    'legacy reused scope',
    { ownerRequest: inspect() },
    'owner_request_scope_and_mode_mismatch'
  ],
  [
    'wrong scope',
    { scope: ATOMIC_PROOF_SCOPE },
    'atomic_scope_mode_incompatible'
  ],
  [
    'wrong marker hash',
    { assetHashes: { ...manifest(), markerSqlSha256: 'f'.repeat(64) } },
    'asset_digest_drift'
  ],
  [
    'extra hash field',
    { assetHashes: { ...manifest(), foo: 2 } },
    'asset_manifest_not_exact'
  ],
  [
    'unknown commit result',
    { simulateUncertainCommit: true },
    'uncertain_commit_requires_fresh_read_only_requery'
  ]
];
for (const [name, change, expected] of planCases) {
  test('staging planner denies ' + name, () => {
    const x = plan(change);
    assert.ok(x.blockers.includes(expected), name);
    block(x);
  });
}
for (const key of REQUIRED_STAGING_EVIDENCE) {
  test('planner requires independently observed ' + key, () => {
    const e = evidence();
    e[key] = false;
    const x = plan({ stagingEvidence: e });
    assert.ok(
      x.blockers.includes('not_all_staging_evidence_independently_observed')
    );
    block(x);
  });
}
test('ambiguous commit requires read-only status requery', () => {
  const x = quoteScoutAtomicFailureDisposition({
    stage: 'transaction_decision',
    commitState: 'ambiguous'
  });
  assert.equal(x.status, 'recovery_safe_hold');
  assert.ok(
    x.blockers.includes(
      'unknown_commit_requires_read_only_marker_and_ledger_requery'
    )
  );
  block(x);
});
test('real awards after commit ban stale backup restoration', () => {
  const x = quoteScoutAtomicFailureDisposition({
    stage: 'verify_final_state_and_no_old_unit_writers',
    commitState: 'committed',
    newPointEventsAfterCommit: 2,
    independentEventJournalVerified: true
  });
  assert.ok(
    x.blockers.includes('stale_backup_restore_would_destroy_new_awards')
  );
  assert.equal(x.staleRestoreMayRun, false);
  block(x);
});
test('missing event journal bans postcommit recovery', () => {
  const x = quoteScoutAtomicFailureDisposition({
    stage: 'transaction_decision',
    commitState: 'committed'
  });
  assert.ok(x.blockers.includes('postcommit_event_journal_not_proven'));
  block(x);
});
test('before commit only hypothetical rollback is reviewed', () => {
  const x = quoteScoutAtomicFailureDisposition({
    stage: 'replace_exact_pinned_security_definer_level_up_5_with_50',
    commitState: 'not_committed'
  });
  assert.equal(x.commitBeforeBoundaryRollbackIsHypothetical, true);
  block(x);
});
test('claimed successful ambiguous requery still cannot resume writers', () => {
  const x = quoteScoutAtomicFailureDisposition({
    stage: 'transaction_decision',
    commitState: 'ambiguous',
    readOnlyMarkerRequeryVerified: true
  });
  assert.equal(x.writerResumePermitted, false);
  block(x);
});
for (const spec of [
  { stage: 'not_found', commitState: 'committed' },
  { stage: 'transaction_decision', commitState: 'unknown' },
  {
    stage: 'transaction_decision',
    commitState: 'committed',
    newPointEventsAfterCommit: -2
  }
]) {
  test('invalid failure state is always held ' + JSON.stringify(spec), () => {
    const x = quoteScoutAtomicFailureDisposition(spec);
    assert.equal(x.status, 'recovery_safe_hold');
    block(x);
  });
}
