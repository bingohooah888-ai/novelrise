import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import {
  PHASE08_REFERENCE,
  PHASE08_INDEPENDENT_GATES,
  PHASE08_ALLOWED_EVIDENCE_STATES,
  createPoint10xPreApprovalEvidenceFixture,
  auditScoutPoint10xPhase08Readiness
} from '../scripts/scout-point10x-phase08-readiness-audit.mjs';
import {
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  SOURCE_RPC_SHA256,
  FIXED_CANDIDATE_RPC_SHA256
} from '../scripts/scout-point10x-atomic-staging-plan.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT,
  MARKER_SQL_SHA256,
  WRITER_DB_RELATIONS
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from '../scripts/scout-point10x-durable-fence-model.mjs';
import { RECOVERY_WRITER_CLASSES } from '../scripts/scout-point10x-recovery-drain-model.mjs';

const expectedInputs = () => ({
  mainSha: PHASE08_REFERENCE.mainSha,
  masterBlobSha: PHASE08_REFERENCE.mainMasterBlobSha,
  primary: {
    number: 2762,
    branch: PHASE08_REFERENCE.primaryBranch,
    baseSha: PHASE08_REFERENCE.mainSha,
    headSha: PHASE08_REFERENCE.baselineHeadSha,
    draft: true,
    open: true,
    merged: false
  },
  sqlCandidate: {
    number: 2763,
    branch: PHASE08_REFERENCE.candidateBranch,
    baseSha: PHASE08_REFERENCE.mainSha,
    headSha: PHASE08_REFERENCE.candidateHeadSha,
    draft: true,
    open: true,
    merged: false,
    rollbackOnly: true,
    rpcAltered: false,
    privateMarkerCreated: false
  },
  issue: {
    number: 294,
    state: 'open',
    title: '[Staging Control] Supabase migration sync'
  },
  workflow: {
    trustedMainAtomicInstalled: false,
    inertFileOutsideWorkflows: true,
    inertEventMapEmpty: true,
    inertJobDisabled: true,
    liveScopeReused: false,
    allLegacyAndAtomicGroupsEqual: false
  },
  evidence: { ...createPoint10xPreApprovalEvidenceFixture() }
});
const review = (change) =>
  auditScoutPoint10xPhase08Readiness({
    ...expectedInputs(),
    ...change
  });
const assertInert = (r) => {
  assert.equal(
    r.state,
    'NOT_READY_FOR_LIVE_STAGING_OR_OWNER_APPROVAL_EXECUTION'
  );
  assert.equal(r.provenance, 'offline_untrusted_static_readiness_review');
  for (const field of [
    'approvalConsumed',
    'actualApprovalVerified',
    'durableCasConnected',
    'actualWriterFenced',
    'backupIndependentlyRestoredInReality',
    'actualCommitResolved',
    'dataPlaneVerified',
    'actualStagingProofCompleted',
    'mayReadSecrets',
    'mayPostApprovalOrClaim',
    'mayWriteDb',
    'mayRunStaging',
    'mayResumeWriters',
    'mayRunSql',
    'mayChangeProduction',
    'mayMergeMain',
    'mayDeploy'
  ])
    assert.equal(r[field], false, field);
  assert.equal(r.selfReportedEvidenceCannotAuthorize, true);
  assert.equal(r.requiresNewSeparateOwnerApproval, true);
  assert.equal(
    r.unsatisfiedGates.every((x) => x.mustRemainBlocked),
    true
  );
  assert.equal(
    r.unsatisfiedGates.every((x) => x.independentlyAuthenticated === false),
    true
  );
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.unsatisfiedGates));
};
const violation = (r, code) => {
  assert.ok(
    r.staticViolations.includes(code),
    JSON.stringify(r.staticViolations)
  );
  assertInert(r);
};
test('baseline is a read-only NOT READY result, not authorization', () => {
  const r = review();
  assertInert(r);
  assert.equal(r.staticViolations.length, 0);
  assert.equal(r.requiredGateCount, 12);
  assert.equal(r.unsatisfiedGates.length, 12);
  assert.equal(r.blockingCount, 12);
  assert.equal(r.knownWriterClassCount, 9);
  assert.equal(r.knownRelationCount, 5);
  assert.equal(r.issueCommentsAreNotLinearizableClaims, true);
});
test('staging and production refs are distinct and expected', () => {
  assert.equal(PHASE08_REFERENCE.stagingProject, STAGING_PROJECT);
  assert.equal(PHASE08_REFERENCE.productionProject, PRODUCTION_PROJECT);
  assert.notEqual(STAGING_PROJECT, PRODUCTION_PROJECT);
  assert.equal(PHASE08_REFERENCE.owner, 'bingohooah888-ai');
  assert.equal(PHASE08_REFERENCE.issue, 294);
});
test('static contract pins both separate atomic modes and hashes', () => {
  assert.equal(PHASE08_REFERENCE.rollbackScope, ATOMIC_PROOF_SCOPE);
  assert.equal(PHASE08_REFERENCE.persistScope, ATOMIC_WRITE_SCOPE);
  assert.notEqual(ATOMIC_PROOF_SCOPE, ATOMIC_WRITE_SCOPE);
  assert.equal(PHASE08_REFERENCE.rollbackMode, APPROVAL_MODES.proof);
  assert.equal(PHASE08_REFERENCE.persistMode, APPROVAL_MODES.persist);
  assert.equal(PHASE08_REFERENCE.sourceRpcSha256, SOURCE_RPC_SHA256);
  assert.equal(
    PHASE08_REFERENCE.candidateRpcSha256,
    FIXED_CANDIDATE_RPC_SHA256
  );
  assert.equal(PHASE08_REFERENCE.markerSqlSha256, MARKER_SQL_SHA256);
  assert.equal(PHASE08_REFERENCE.mutationDomain, MUTATION_DOMAIN);
});
test('required gates have no duplicate or missing identifier', () => {
  const ids = PHASE08_INDEPENDENT_GATES.map((x) => x.id);
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(
    PHASE08_INDEPENDENT_GATES.every((x) => x.priority === 1 || x.priority === 2)
  );
  assert.ok(PHASE08_INDEPENDENT_GATES.every((x) => x.next.length > 35));
});
test('all nine Writer classes and five DB relations stay in the audit', () => {
  assert.equal(RECOVERY_WRITER_CLASSES.length, 9);
  assert.equal(WRITER_DB_RELATIONS.length, 5);
  assert.ok(WRITER_DB_RELATIONS.includes('public.scout_xp_ledger'));
  assert.ok(WRITER_DB_RELATIONS.includes('public.scout_point_ledger'));
});
test('offline default fixture requires all twelve proofs', () => {
  const evidence = createPoint10xPreApprovalEvidenceFixture();
  assert.ok(Object.isFrozen(evidence));
  assert.deepEqual(
    Object.keys(evidence).sort(),
    PHASE08_INDEPENDENT_GATES.map((g) => g.id).sort()
  );
  for (const state of Object.values(evidence)) {
    assert.equal(state, 'offline_model_only');
  }
  assertInert(review());
});
test('even every caller-asserted live value cannot authenticate an OWNER', () => {
  const input = expectedInputs();
  for (const key of Object.keys(input.evidence)) {
    input.evidence[key] = 'live_claim_untrusted';
  }
  const r = review(input);
  assert.equal(r.blockingCount, 12);
  assert.ok(
    r.unsatisfiedGates.every((g) => g.observed === 'live_claim_untrusted')
  );
  assertInert(r);
});
for (const state of PHASE08_ALLOWED_EVIDENCE_STATES) {
  test('single gate caller state cannot open staging: ' + state, () => {
    const input = expectedInputs();
    input.evidence.durable_linearizable_claim = state;
    assertInert(review(input));
  });
}
for (const gate of PHASE08_INDEPENDENT_GATES) {
  test('missing one readiness gate fails closed: ' + gate.id, () => {
    const input = expectedInputs();
    delete input.evidence[gate.id];
    const r = review(input);
    violation(r, 'unrecognized_missing_or_extra_gate_evidence');
    assert.equal(
      r.unsatisfiedGates.find((x) => x.id === gate.id).observed,
      'invalid_evidence'
    );
  });
  test(
    'untrusted positive for one gate never enables action: ' + gate.id,
    () => {
      const input = expectedInputs();
      input.evidence[gate.id] = 'live_claim_untrusted';
      const r = review(input);
      assert.equal(
        r.unsatisfiedGates.find((x) => x.id === gate.id).observed,
        'live_claim_untrusted'
      );
      assertInert(r);
    }
  );
}
const badMain = [
  [
    'wrong main',
    'b'.repeat(40),
    'main_sha_changed_requires_new_full_preflight'
  ],
  ['malformed main', 'not-sha', 'main_sha_changed_requires_new_full_preflight']
];
for (const [name, value, code] of badMain) {
  test(name + ' requires new full preflight', () =>
    violation(review({ mainSha: value }), code)
  );
}
test('changed MASTER blob must require new full preflight', () =>
  violation(
    review({ masterBlobSha: 'b'.repeat(40) }),
    'master_blob_changed_requires_new_full_preflight'
  ));
const badPrimary = [
  ['head changed', { headSha: 'd'.repeat(40) }],
  ['base changed', { baseSha: 'c'.repeat(40) }],
  ['branch changed', { branch: 'main' }],
  ['number changed', { number: 2763 }],
  ['merged', { merged: true }],
  ['closed', { open: false }],
  ['undrafted', { draft: false }]
];
for (const [name, change] of badPrimary) {
  test('new PR gate blocks: ' + name, () => {
    const input = expectedInputs();
    violation(
      review({ primary: { ...input.primary, ...change } }),
      'primary_pr_not_baseline_draft'
    );
  });
}
const badCandidate = [
  ['head changed', { headSha: 'd'.repeat(40) }],
  ['branch changed', { branch: 'unknown' }],
  ['number changed', { number: 1000 }],
  ['base changed', { baseSha: 'd'.repeat(40) }],
  ['not draft', { draft: false }],
  ['closed', { open: false }],
  ['merged', { merged: true }],
  ['no longer rollback-only', { rollbackOnly: false }],
  ['RPC now altered', { rpcAltered: true }],
  ['marker now created', { privateMarkerCreated: true }]
];
for (const [name, change] of badCandidate) {
  test('rollback-only SQL candidate must remain isolated: ' + name, () => {
    const input = expectedInputs();
    violation(
      review({ sqlCandidate: { ...input.sqlCandidate, ...change } }),
      'sql_candidate_must_remain_rollback_only_draft'
    );
  });
}
for (const [name, change] of [
  ['wrong issue', { number: 999 }],
  ['issue closed', { state: 'closed' }],
  ['issue title changed', { title: 'other' }]
]) {
  test('Issue294 metadata drift blocks: ' + name, () => {
    const input = expectedInputs();
    violation(
      review({ issue: { ...input.issue, ...change } }),
      'issue_294_incorrect_or_unverified'
    );
  });
}
const workflowBad = [
  'trustedMainAtomicInstalled',
  'inertFileOutsideWorkflows',
  'inertEventMapEmpty',
  'inertJobDisabled',
  'liveScopeReused',
  'allLegacyAndAtomicGroupsEqual'
];
for (const field of workflowBad) {
  test('changing topology observation triggers re-audit: ' + field, () => {
    const input = expectedInputs();
    input.workflow[field] = !input.workflow[field];
    violation(
      review(input),
      'workflow_topology_not_verified_at_fixed_baseline'
    );
  });
}
test('unknown evidence field is not silently accepted', () => {
  const input = expectedInputs();
  input.evidence.unknown_unlock = 'live_claim_untrusted';
  violation(review(input), 'unrecognized_missing_or_extra_gate_evidence');
});
test('unknown evidence token is marked invalid not trusted', () => {
  const input = expectedInputs();
  input.evidence.trusted_main_executor = 'actual_staging_authorized';
  const r = review(input);
  assert.equal(r.unsatisfiedGates[0].observed, 'invalid_evidence');
  assertInert(r);
});
test('missing metadata never counts as safe and never throws', () => {
  const r = auditScoutPoint10xPhase08Readiness();
  assert.ok(r.staticViolations.length >= 5);
  assertInert(r);
});
test('read-only YAML design not registered in active workflow directory', () => {
  const url = new URL(
    '../docs/plans/READER-REWARD-POINT10X-OWNER-LEDGER-INERT-WORKFLOW-20261105.yml',
    import.meta.url
  );
  const blueprint = readFileSync(fileURLToPath(url), 'utf8');
  assert.match(blueprint, /"on": \{\}/u);
  assert.match(blueprint, /if: \$\{\{ false \}\}/u);
  assert.match(blueprint, /INERT WORKFLOW BLUEPRINT/u);
  assert.match(
    blueprint,
    /group: novelight-issue294-staging-atomic-review-inert/u
  );
  assert.doesNotMatch(blueprint, /secrets\.\w+/u);
});
test('existing rollback-only active-workflow candidate has different locks', () => {
  const url = new URL(
    '../.github/workflows/staging-reader-point-tenfold-proof.yml',
    import.meta.url
  );
  const workflow = readFileSync(fileURLToPath(url), 'utf8');
  assert.match(workflow, /group: novelight-reader-point10x-admit-issue294/u);
  assert.match(workflow, /group: supabase-staging-migration-sync/u);
  assert.doesNotMatch(
    workflow,
    /group: novelight-issue294-staging-atomic-review-inert/u
  );
});
test('atomic Staging mode and rollback-only SQL candidate must remain independent', () => {
  const file = readFileSync(
    fileURLToPath(
      new URL(
        '../scripts/scout-point10x-atomic-staging-plan.mjs',
        import.meta.url
      )
    ),
    'utf8'
  );
  assert.match(file, /ATOMIC_PROOF_SCOPE/u);
  assert.match(file, /ATOMIC_WRITE_SCOPE/u);
  assert.match(file, /atomic-persistent-staging-cutover/u);
});
test('all output is frozen or explicitly static, no secrets/logs/actions', () => {
  const r = review();
  assert.ok(Object.isFrozen(r.staticViolations));
  assert.ok(Object.isFrozen(r.unsatisfiedGates[0]));
  assert.deepEqual(
    r.unsatisfiedGates.map((x) => x.priority).filter((x) => x === 1).length,
    10
  );
  assertInert(r);
});
