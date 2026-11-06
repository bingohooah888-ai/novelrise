import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import {
  readPinnedCatalogSql,
  PINNED_CATALOG_SQL_SHA256,
  REQUIRED_CATALOG_SECTIONS,
  OWNER_CONTROL_ISSUE,
  PROPOSED_CATALOG_SCOPE
} from '../scripts/scout-point10x-catalog-readonly-review.mjs';
import {
  readAddendumSql,
  ADDENDUM_SQL_SHA256,
  ADDENDUM_IDS
} from '../scripts/scout-point10x-privileged-catalog-addendum.mjs';
import {
  PROPOSED_BUNDLE_SCOPE,
  BUNDLE_SQL_HASHES,
  computeProposedBundleDigest
} from '../scripts/scout-point10x-catalog-evidence-union.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from '../scripts/scout-point10x-durable-fence-model.mjs';
import {
  SINGLE_SNAPSHOT_IDS,
  SNAPSHOT_PLAN_SCOPE,
  PLAN_SEQUENCE,
  SNAPSHOT_TXN_BOUNDARY,
  REQUIRED_FAIL_CLOSED,
  makeInertSnapshotManifest,
  makeGoodSyntheticTrace,
  reviewInertSnapshotTrace,
  reviewSnapshotOwnerClaimContract,
  newHypotheticalSpentState,
  reviewHypotheticalSpentTrace
} from '../scripts/scout-point10x-single-snapshot-review.mjs';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const manifest = () => makeInertSnapshotManifest();
const trace = () => makeGoodSyntheticTrace(manifest());
const request = () => ({
  scope: SNAPSHOT_PLAN_SCOPE,
  issueNumber: OWNER_CONTROL_ISSUE,
  operation: 'read-catalog-11-same-snapshot',
  stagingRef: STAGING_PROJECT,
  mainSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  planDigest: manifest().planDigest,
  originalSqlDigests: { ...BUNDLE_SQL_HASHES },
  commentId: 932713
});
function noAuthority(r) {
  for (const key of [
    'authenticatedOwner',
    'actualControlClaimed',
    'actualSpentConsumed',
    'singleRealSnapshotVerified',
    'realSqlExecuted',
    'actualCatalogCompared',
    'realPrivilegedWriterFenced',
    'mayConnectDb',
    'mayRunSql',
    'mayWriteDb',
    'mayClaimOwner',
    'mayUseDocker',
    'mayRunStaging',
    'mayChangeProduction',
    'mayMergeMain',
    'mayDeploy'
  ])
    assert.equal(r[key], false, key);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.blockers));
}
function blocked(r, reason) {
  assert.ok(
    r.blockers.includes(reason),
    'expected ' + reason + ' in ' + r.blockers.join(',')
  );
  noAuthority(r);
}
test('the original two source SQL files remain byte-for-byte SHA pinned', () => {
  assert.equal(sha(readPinnedCatalogSql()), PINNED_CATALOG_SQL_SHA256);
  assert.equal(sha(readAddendumSql()), ADDENDUM_SQL_SHA256);
  assert.deepEqual(
    [...SINGLE_SNAPSHOT_IDS],
    [...REQUIRED_CATALOG_SECTIONS, ...ADDENDUM_IDS]
  );
});
test('one proposed physical session, one readonly repeatable-read tx, rollback', () => {
  assert.equal(SNAPSHOT_TXN_BOUNDARY.connectionCount, 1);
  assert.equal(
    SNAPSHOT_TXN_BOUNDARY.transactionBegin,
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'
  );
  assert.equal(SNAPSHOT_TXN_BOUNDARY.termination, 'ROLLBACK');
  assert.equal(SNAPSHOT_TXN_BOUNDARY.permittedStatementCount, 11);
  assert.equal(SNAPSHOT_TXN_BOUNDARY.executionEnabled, false);
  assert.equal(SNAPSHOT_TXN_BOUNDARY.sourceSQLMayBeChanged, false);
});
test('11 exact pinned SELECT fragments exist in immutable source metadata', () => {
  const r = manifest();
  assert.equal(r.sectionCount, 11);
  assert.equal(r.statements.length, 11);
  assert.equal(r.statements[0].id, 'NL-CATALOG-01');
  assert.equal(r.statements[10].id, 'NL-GAP-03');
  assert.deepEqual(
    r.statements.map((x) => x.id),
    SINGLE_SNAPSHOT_IDS
  );
  assert.deepEqual(
    r.statements.map((x) => x.order),
    Array.from({ length: 11 }, (_, i) => i + 1)
  );
  assert.equal(new Set(r.statements.map((x) => x.queryDigest)).size, 11);
  assert.ok(r.statements.every((x) => /^[a-f0-9]{64}$/u.test(x.queryDigest)));
  assert.ok(
    r.statements.every(
      (x) => x.containsOnlyOneTopLevelSelectUnderExactSourcePin
    )
  );
  assert.match(r.planDigest, /^[a-f0-9]{64}$/u);
  assert.equal(r.actualPostgresParserValidation, false);
  assert.equal(r.staticFragmentAnalysisOnly, true);
  assert.equal(r.status, 'NO_GO_INERT_SNAPSHOT_PLAN_ONLY');
  assert.equal(r.blockers.length, REQUIRED_FAIL_CLOSED.length);
  noAuthority(r);
});
for (const blocker of REQUIRED_FAIL_CLOSED) {
  test('even canonical source retains real-world NO-GO: ' + blocker, () => {
    blocked(manifest(), blocker);
  });
}
test('changing source text without changing real SQL is still forbidden by hash', () => {
  const m = makeInertSnapshotManifest({
    baseSql: readPinnedCatalogSql() + '\n',
    addendumSql: readAddendumSql().toString()
  });
  blocked(m, 'BASE_SQL_BYTES_HASH_MISMATCH');
});
test('changed addendum byte digest fails closed', () => {
  blocked(
    makeInertSnapshotManifest({
      baseSql: readPinnedCatalogSql(),
      addendumSql: readAddendumSql().toString() + ' '
    }),
    'ADDENDUM_SQL_BYTES_HASH_MISMATCH'
  );
});
test('missing SQL source is not silently synthesized', () => {
  blocked(
    makeInertSnapshotManifest({
      baseSql: null,
      addendumSql: readAddendumSql().toString()
    }),
    'BASE_SOURCE_NOT_TEXT'
  );
});
for (const id of SINGLE_SNAPSHOT_IDS) {
  test('missing SELECT section is detected: ' + id, () => {
    const inBase = id.startsWith('NL-CATALOG');
    const b = readPinnedCatalogSql(),
      a = readAddendumSql().toString();
    const changed = (s) => s.replace('-- ' + id + ':', '-- INVALID:');
    const r = makeInertSnapshotManifest({
      baseSql: inBase ? changed(b) : b,
      addendumSql: inBase ? a : changed(a)
    });
    const prefix = inBase ? 'BASE' : 'ADDENDUM';
    blocked(
      r,
      prefix +
        (id === 'NL-CATALOG-08' || id === 'NL-GAP-03'
          ? '_SECTION_COUNT_INVALID'
          : '_SECTION_ORDER_INVALID')
    );
  });
}
test('additional COMMIT in source is rejected', () => {
  blocked(
    makeInertSnapshotManifest({
      baseSql: readPinnedCatalogSql().replace(
        'ROLLBACK;',
        'COMMIT;\nROLLBACK;'
      ),
      addendumSql: readAddendumSql().toString()
    }),
    'BASE_UNEXPECTED_TRANSACTION_CONTROL'
  );
});
test('read-write isolation is not considered same read-only transaction', () => {
  blocked(
    makeInertSnapshotManifest({
      baseSql: readPinnedCatalogSql().replace(
        'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;',
        'BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ WRITE;'
      ),
      addendumSql: readAddendumSql().toString()
    }),
    'BASE_READONLY_BEGIN_INVALID'
  );
});
test('two nested source BEGINs detected', () => {
  blocked(
    makeInertSnapshotManifest({
      baseSql: readPinnedCatalogSql().replace(
        'ROLLBACK;',
        'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nROLLBACK;'
      ),
      addendumSql: readAddendumSql().toString()
    }),
    'BASE_READONLY_BEGIN_INVALID'
  );
});
test('non-SELECT mutation substituted into pinned SQL fails review', () => {
  blocked(
    makeInertSnapshotManifest({
      baseSql: readPinnedCatalogSql().replace(
        "SELECT\n  'NL-CATALOG-01'",
        "UPDATE public.scout_point_ledger SET amount=1;\nSELECT\n  'NL-CATALOG-01'"
      ),
      addendumSql: readAddendumSql().toString()
    }),
    'BASE_SQL_BYTES_HASH_MISMATCH'
  );
});
test('synthetic event stream uses one connection and immutable source IDs', () => {
  const r = reviewInertSnapshotTrace({ manifest: manifest(), trace: trace() });
  assert.equal(r.status, 'NO_GO_SYNTHETIC_SNAPSHOT_TRACE_ONLY');
  assert.equal(r.completeSyntheticSectionCount, 11);
  assert.equal(r.invariantPassInFixture, true);
  assert.equal(r.noRealSameSnapshotProof, true);
  noAuthority(r);
});
test('no trace and nonobject trace are rejected', () => {
  blocked(
    reviewInertSnapshotTrace({ manifest: manifest() }),
    'TRACE_RECORD_REQUIRED'
  );
  blocked(
    reviewInertSnapshotTrace({ manifest: manifest(), trace: null }),
    'TRACE_RECORD_REQUIRED'
  );
});
test('trace with wrong plan hash refused', () => {
  const t = trace();
  blocked(
    reviewInertSnapshotTrace({
      manifest: manifest(),
      trace: { ...t, planDigest: 'e'.repeat(64) }
    }),
    'TRACE_PLAN_DIGEST_MISMATCH'
  );
});
test('trace with changed source hash is rejected', () => {
  const t = trace();
  blocked(
    reviewInertSnapshotTrace({
      manifest: manifest(),
      trace: {
        ...t,
        sourceSqlDigests: { ...t.sourceSqlDigests, addendum: 'e'.repeat(64) }
      }
    }),
    'TRACE_BOTH_SOURCE_DIGESTS_REQUIRED'
  );
});
test('split connection is not a single snapshot', () => {
  const t = trace();
  const events = t.events.map((x) => ({ ...x }));
  events[8].sessionToken = 'fixture-another-connection';
  blocked(
    reviewInertSnapshotTrace({ trace: { ...t, events } }),
    'TRACE_SPLIT_CONNECTION_TRANSACTION_OR_SNAPSHOT'
  );
});
test('split transaction is not a single snapshot', () => {
  const t = trace();
  const events = t.events.map((x) => ({ ...x }));
  events[4].transactionToken = 'fixture-tx-other';
  blocked(
    reviewInertSnapshotTrace({ trace: { ...t, events } }),
    'TRACE_SPLIT_CONNECTION_TRANSACTION_OR_SNAPSHOT'
  );
});
test('split snapshot token is never treated as equivalent', () => {
  const t = trace();
  const events = t.events.map((x) => ({ ...x }));
  events[6].snapshotToken = 'fixture-other-snapshot';
  blocked(
    reviewInertSnapshotTrace({ trace: { ...t, events } }),
    'TRACE_SPLIT_CONNECTION_TRANSACTION_OR_SNAPSHOT'
  );
});
test('an extra SELECT breaks exact 11 statement cardinality', () => {
  const t = trace();
  const events = t.events.map((x) => ({ ...x }));
  events.splice(2, 0, { ...events[2], sectionId: 'NL-GAP-99' });
  blocked(
    reviewInertSnapshotTrace({ trace: { ...t, events } }),
    'ONE_BEGIN_ELEVEN_SELECTS_ONE_ROLLBACK_REQUIRED'
  );
});
test('duplicate section ID is rejected by ordering', () => {
  const t = trace(),
    events = t.events.map((x) => ({ ...x }));
  events[5].sectionId = events[4].sectionId;
  blocked(
    reviewInertSnapshotTrace({ trace: { ...t, events } }),
    'SELECT_SEQUENCE_OR_SECTION_MISMATCH'
  );
});
test('partial output / missing result digest -> HOLD', () => {
  const t = trace(),
    events = t.events.map((x) => ({ ...x }));
  events[4].resultDigest = null;
  blocked(
    reviewInertSnapshotTrace({ trace: { ...t, events } }),
    'QUERY_RESULT_INCOMPLETE_OR_FAILED'
  );
});
test('zero results are only a cardinality value, not evidence of coverage', () => {
  const t = trace(),
    events = t.events.map((x) => ({ ...x }));
  events[4].rowCount = 0;
  const r = reviewInertSnapshotTrace({ trace: { ...t, events } });
  assert.equal(r.noRealSameSnapshotProof, true);
  noAuthority(r);
});
test('one SQL error forces HOLD, not partial report', () => {
  const t = trace(),
    events = t.events.map((x) => ({ ...x }));
  events[10].status = 'error';
  blocked(
    reviewInertSnapshotTrace({ trace: { ...t, events } }),
    'QUERY_RESULT_INCOMPLETE_OR_FAILED'
  );
});
test('COMMIT or DML event is never allowed', () => {
  const t = trace(),
    events = t.events.map((x) => ({ ...x }));
  events[12].action = 'COMMIT';
  blocked(
    reviewInertSnapshotTrace({ trace: { ...t, events } }),
    'TRACE_FORBIDDEN_MUTATION_OR_COMMIT'
  );
});
test('uncertain ROLLBACK ACK forces HOLD', () => {
  const t = trace(),
    events = t.events.map((x) => ({ ...x }));
  events[12].rollbackAck = 'lost';
  blocked(
    reviewInertSnapshotTrace({ trace: { ...t, events } }),
    'ROLLBACK_ACK_MISSING_OR_UNCERTAIN'
  );
});
test('read-write BEGIN is invalid even with 11 successful SELECTs', () => {
  const t = trace(),
    events = t.events.map((x) => ({ ...x }));
  events[0].readOnly = false;
  blocked(
    reviewInertSnapshotTrace({ trace: { ...t, events } }),
    'READONLY_REPEATABLE_READ_NOT_ESTABLISHED'
  );
});
test('wrong DB target including production is denied', () => {
  const t = trace(),
    events = t.events.map((x) => ({ ...x }));
  events[2].dbRef = PRODUCTION_PROJECT;
  blocked(
    reviewInertSnapshotTrace({ trace: { ...t, events } }),
    'TRACE_WRONG_DB_TARGET'
  );
});
test('unknown cursor/session context rejected', () => {
  const t = trace(),
    events = t.events.map((x) => ({ ...x }));
  events[0].sessionToken = 'real-claimed';
  blocked(
    reviewInertSnapshotTrace({ trace: { ...t, events } }),
    'SYNTHETIC_TRANSACTION_CONTEXT_MISSING'
  );
});
test('metadata strings from fixture never appear in output', () => {
  const t = trace(),
    events = t.events.map((x) => ({ ...x }));
  events[3].secret = 'SECRET_TEST_SHOULD_NEVER_LEAK';
  const r = reviewInertSnapshotTrace({ trace: { ...t, events } });
  assert.ok(!JSON.stringify(r).includes('SECRET_TEST_SHOULD_NEVER_LEAK'));
  noAuthority(r);
});
test('separate scope requires fresh OWNER approval, old scopes are not reusable', () => {
  assert.notEqual(SNAPSHOT_PLAN_SCOPE, PROPOSED_CATALOG_SCOPE);
  assert.notEqual(SNAPSHOT_PLAN_SCOPE, PROPOSED_BUNDLE_SCOPE);
  assert.equal(OWNER_CONTROL_ISSUE, 294);
  const r = reviewSnapshotOwnerClaimContract({ request: request() });
  assert.equal(r.status, 'HOLD_SNAPSHOT_OWNER_GATE_NOT_INSTALLED');
  assert.equal(r.notAnOwnerApproval, true);
  assert.equal(r.existingBundleScopePermitted, false);
  assert.equal(r.trustedMainExecutorInstalled, false);
  assert.equal(r.spentControlDatabaseImplemented, false);
  assert.equal(r.requiredSteps.length, 12);
  noAuthority(r);
});
for (const [label, patch, reason] of [
  [
    'old catalog scope',
    { scope: PROPOSED_CATALOG_SCOPE },
    'FRESH_SNAPSHOT_ONLY_SCOPE_REQUIRED'
  ],
  [
    'old bundle scope',
    { scope: PROPOSED_BUNDLE_SCOPE },
    'FRESH_SNAPSHOT_ONLY_SCOPE_REQUIRED'
  ],
  [
    'persist operation',
    { operation: 'persist' },
    'READ_ONLY_SNAPSHOT_OPERATION_REQUIRED'
  ],
  ['wrong issue', { issueNumber: 295 }, 'OWNER_ISSUE_294_REQUIRED'],
  [
    'production target',
    { stagingRef: PRODUCTION_PROJECT },
    'STAGING_ONLY_IDENTITY_REQUIRED'
  ],
  [
    'stale main',
    { mainSha: 'invalid' },
    'OWNER_EXACT_MAIN_AND_PR_HEAD_REQUIRED'
  ],
  [
    'stale head',
    { headSha: 'invalid' },
    'OWNER_EXACT_MAIN_AND_PR_HEAD_REQUIRED'
  ],
  [
    'wrong digest',
    { planDigest: 'f'.repeat(64) },
    'PINNED_MANIFEST_DIGEST_REQUIRED'
  ],
  [
    'changed SQL digest',
    {
      originalSqlDigests: {
        base: 'f'.repeat(64),
        addendum: ADDENDUM_SQL_SHA256
      }
    },
    'BOTH_ORIGINAL_SQL_DIGESTS_REQUIRED'
  ],
  ['missing comment', { commentId: 0 }, 'UNIQUE_NEW_OWNER_COMMENT_REQUIRED'],
  [
    'spoofed owner',
    { ownerProof: { verified: true } },
    'CALLER_OWNER_AUTHORITY_SELF_ASSERTION_REJECTED'
  ],
  [
    'spoofed live proof',
    { liveVerified: true },
    'CALLER_OWNER_AUTHORITY_SELF_ASSERTION_REJECTED'
  ]
]) {
  test('scoped OWNER contract refuses ' + label, () => {
    blocked(
      reviewSnapshotOwnerClaimContract({
        request: { ...request(), ...patch }
      }),
      reason
    );
  });
}
test('no request cannot create owner approval', () => {
  blocked(reviewSnapshotOwnerClaimContract(), 'EXACT_OWNER_REQUEST_REQUIRED');
});
test('CONTROL CAS is a review-only immutable symbolic state', () => {
  const r = newHypotheticalSpentState();
  assert.equal(r.domain, MUTATION_DOMAIN);
  assert.equal(r.version, 0);
  assert.equal(r.epoch, 0);
  assert.deepEqual(r.spent, []);
  assert.ok(Object.isFrozen(r));
});
const cas = (state, commentId = 932713, opts = {}) =>
  reviewHypotheticalSpentTrace({
    state,
    commentId,
    expectedVersion: state.version,
    expectedEpoch: state.epoch,
    ...opts
  });
test('synthetic spent is not real OWNER consumption', () => {
  const s = newHypotheticalSpentState();
  const r = cas(s);
  assert.equal(r.status, 'MODEL_SPENT_NOT_REAL');
  assert.deepEqual(r.modelState.spent, [932713]);
  assert.equal(r.modelState.version, 1);
  assert.equal(r.modelState.epoch, 1);
  assert.equal(s.version, 0);
  assert.equal(r.noRetry, true);
  noAuthority(r);
});
test('duplicate spent approval cannot be reused', () => {
  const r = cas(newHypotheticalSpentState());
  blocked(cas(r.modelState), 'COMMENT_ALREADY_SPENT');
});
test('different comment cannot preempt shared domain', () => {
  const r = cas(newHypotheticalSpentState());
  blocked(cas(r.modelState, 932714), 'MUTATION_DOMAIN_NOT_FREE');
});
test('outdated version or epoch causes HOLD', () => {
  const state = newHypotheticalSpentState();
  blocked(
    cas(state, 932713, { expectedVersion: 1 }),
    'STALE_CAS_VERSION_OR_FENCE_EPOCH'
  );
  blocked(
    cas(state, 932713, { expectedEpoch: 1 }),
    'STALE_CAS_VERSION_OR_FENCE_EPOCH'
  );
});
for (const ack of ['lost', 'unknown']) {
  test('uncertain COMMIT response prohibits reattempt: ' + ack, () => {
    const r = cas(newHypotheticalSpentState(), 932713, { commitAck: ack });
    assert.equal(r.status, 'HOLD_MODEL_LOST_COMMIT_ACK');
    assert.equal(r.modelState.commitUnknown, true);
    assert.equal(r.noRetry, true);
    blocked(cas(r.modelState, 932714), 'UNCERTAIN_COMMIT_READBACK_REQUIRED');
  });
}
test('invalid spent state cannot mint progress', () => {
  blocked(
    reviewHypotheticalSpentTrace({
      state: {},
      commentId: 932713,
      expectedVersion: 0,
      expectedEpoch: 0
    }),
    'INVALID_DURABLE_CAS_FIXTURE'
  );
});
test('invalid ACK never creates symbolic spent', () => {
  blocked(
    cas(newHypotheticalSpentState(), 932713, {
      commitAck: 'certain-real-commit'
    }),
    'COMMIT_ACK_UNKNOWN_FORMAT'
  );
});
test('no plugin/API/sql runner or network code in inert module', () => {
  const source = readFileSync(
    fileURLToPath(
      new URL(
        '../scripts/scout-point10x-single-snapshot-review.mjs',
        import.meta.url
      )
    ),
    'utf8'
  );
  assert.doesNotMatch(source, /execute_sql\s*\(/u);
  assert.doesNotMatch(source, /createClient\s*\(/u);
  assert.doesNotMatch(source, /spawnSync\s*\(/u);
  assert.doesNotMatch(source, /https?:\/\//u);
  assert.match(source, /mayRunSql:\s*false/u);
  assert.equal(computeProposedBundleDigest().length, 64);
  assert.equal(PLAN_SEQUENCE.length, 12);
});
