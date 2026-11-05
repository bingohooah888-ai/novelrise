import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import {
  MOCK_PROTOCOL,
  makeGoodOfflineFixture,
  replayOfflineElevenSelects
} from '../scripts/scout-point10x-offline-orchestration-mock.mjs';
import {
  makeInertSnapshotManifest,
  SNAPSHOT_PLAN_SCOPE,
  SNAPSHOT_TXN_BOUNDARY,
  REQUIRED_FAIL_CLOSED
} from '../scripts/scout-point10x-single-snapshot-review.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';

const clone = () => JSON.parse(JSON.stringify(makeGoodOfflineFixture()));
const replay = (fixture, manifest) =>
  replayOfflineElevenSelects({ fixture, ...(manifest ? { manifest } : {}) });
function noLiveAuthority(r) {
  assert.equal(r.decision, 'NO_GO');
  assert.equal(r.realDatabaseConnections, 0);
  for (const key of [
    'realSqlExecuted',
    'actualCatalogCompared',
    'authenticatedOwner',
    'actualControlClaimed',
    'actualSpentConsumed',
    'singleRealSnapshotVerified',
    'realPrivilegedWriterFenced',
    'mayConnectDb',
    'mayRunSql',
    'mayWriteDb',
    'mayClaimOwner',
    'mayUseDocker',
    'mayRunStaging',
    'mayChangeProduction',
    'mayMergeMain',
    'mayDeploy',
    'autoRetry'
  ])
    assert.equal(r[key], false, key);
  assert.equal(r.noRetryAfterUnknownCommit, true);
  assert.equal(r.sourceTrust, 'UNTRUSTED_OFFLINE_FIXTURE');
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.blockers));
  for (const blocker of REQUIRED_FAIL_CLOSED)
    assert.ok(r.blockers.includes(blocker));
}
function good() {
  const r = replay(clone());
  assert.equal(r.status, 'NO_GO_OFFLINE_MOCK_ONLY', r.blockers.join(','));
  assert.equal(r.invariantPassInFixture, true);
  assert.equal(r.syntheticSelectCount, 11);
  assert.equal(r.partialResultsDiscarded, false);
  noLiveAuthority(r);
  return r;
}
function bad(mutator, blocker) {
  const f = clone();
  mutator(f);
  const r = replay(f);
  assert.equal(r.status, 'HOLD_OFFLINE_MOCK', JSON.stringify(r));
  assert.equal(r.invariantPassInFixture, false);
  assert.equal(r.syntheticSelectCount, 0);
  assert.equal(r.partialResultsDiscarded, true);
  assert.ok(r.blockers.includes(blocker), r.blockers.join(','));
  noLiveAuthority(r);
}
const expected = {
  lifecycle: 'MOCK_LIFECYCLE_ORDER_INVALID',
  transport: 'SECOND_ATTEMPT_RECONNECT_OR_REAL_TRANSPORT_FORBIDDEN',
  selection: 'SELECT_ORDER_COUNT_OR_STATEMENT_DIGEST_INVALID',
  result: 'SELECT_FAILURE_TIMEOUT_OR_MALFORMED_RESULT',
  context: 'CROSS_CONNECTION_SESSION_TRANSACTION_OR_SNAPSHOT',
  privilege: 'PRIVILEGED_PATH_COVERAGE_UNKNOWN_OR_INVALID'
};

test('all 11 exact SQL sections and digests replay in one inert connection/transaction', () => {
  const f = clone();
  const m = makeInertSnapshotManifest();
  assert.equal(f.protocol, MOCK_PROTOCOL);
  assert.equal(f.events.length, 15);
  assert.deepEqual(
    f.events.map((e) => e.action),
    [
      'MOCK_OPEN',
      'MOCK_BEGIN',
      ...Array(11).fill('MOCK_SELECT'),
      'MOCK_ROLLBACK',
      'MOCK_CLOSE'
    ]
  );
  assert.deepEqual(
    f.events.slice(2, 13).map((e) => [e.sectionId, e.statementDigest]),
    m.statements.map((e) => [e.id, e.queryDigest])
  );
  assert.equal(
    f.events[1].command,
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'
  );
  assert.equal(f.events[13].rollbackAck, 'received');
  assert.ok(f.events.every((e) => e.dbRef === STAGING_PROJECT));
  good();
});
test('snapshot SQL sources are not changed by the mock harness', () => {
  const sources = [
    [
      '../docs/plans/READER-REWARD-POINT10X-STAGING-CATALOG-READONLY-20261105.sql',
      SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.base
    ],
    [
      '../docs/plans/READER-REWARD-POINT10X-STAGING-PRIVILEGED-CATALOG-ADDENDUM-20261105.sql',
      SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.addendum
    ]
  ];
  for (const [path, expectedHash] of sources) {
    const src = readFileSync(fileURLToPath(new URL(path, import.meta.url)));
    assert.equal(createHash('sha256').update(src).digest('hex'), expectedHash);
  }
});
test('empty or non-protocol mock is rejected', () => {
  const r = replayOfflineElevenSelects({ fixture: null });
  assert.equal(r.status, 'HOLD_OFFLINE_MOCK');
  assert.ok(r.blockers.includes('MOCK_PROTOCOL_REQUIRED'));
  noLiveAuthority(r);
});
test('no real driver callback is evaluated, even when supplied by caller', () => {
  const f = clone();
  f.driver = () => {
    throw new Error('MUST NEVER RUN');
  };
  f.transport.connect = () => {
    throw new Error('MUST NEVER CONNECT');
  };
  assert.equal(replay(f).status, 'NO_GO_OFFLINE_MOCK_ONLY');
});
test('tampered imported manifest is not trusted', () => {
  const f = clone();
  const m = JSON.parse(JSON.stringify(makeInertSnapshotManifest()));
  m.statements[2].queryDigest = '0'.repeat(64);
  const r = replay(f, m);
  assert.equal(r.status, 'HOLD_OFFLINE_MOCK');
  assert.ok(r.blockers.includes('PINNED_MANIFEST_NOT_CANONICAL'));
});
const cases = [
  [
    'wrong protocol',
    (f) => {
      f.protocol = 'REAL';
    },
    'MOCK_PROTOCOL_REQUIRED'
  ],
  [
    'wrong plan digest',
    (f) => {
      f.planDigest = '0'.repeat(64);
    },
    'SOURCE_OR_PLAN_DIGEST_MISMATCH'
  ],
  [
    'wrong base SQL hash',
    (f) => {
      f.sourceSqlDigests.base = '0'.repeat(64);
    },
    'SOURCE_OR_PLAN_DIGEST_MISMATCH'
  ],
  [
    'wrong addendum hash',
    (f) => {
      f.sourceSqlDigests.addendum = '0'.repeat(64);
    },
    'SOURCE_OR_PLAN_DIGEST_MISMATCH'
  ],
  [
    'missing OPEN',
    (f) => {
      f.events.shift();
    },
    'ONE_OPEN_BEGIN_ELEVEN_SELECTS_ROLLBACK_CLOSE_REQUIRED'
  ],
  [
    'duplicate connection event',
    (f) => {
      f.events.unshift({ ...f.events[0] });
    },
    'ONE_OPEN_BEGIN_ELEVEN_SELECTS_ROLLBACK_CLOSE_REQUIRED'
  ],
  [
    'BEGIN swapped with SELECT',
    (f) => {
      [f.events[1], f.events[2]] = [f.events[2], f.events[1]];
    },
    expected.lifecycle
  ],
  [
    'BEGIN read-write',
    (f) => {
      f.events[1].readOnly = false;
    },
    'READ_ONLY_REPEATABLE_READ_NOT_ENFORCED'
  ],
  [
    'BEGIN read-committed',
    (f) => {
      f.events[1].isolation = 'READ COMMITTED';
    },
    'READ_ONLY_REPEATABLE_READ_NOT_ENFORCED'
  ],
  [
    'BEGIN altered SQL',
    (f) => {
      f.events[1].command = 'BEGIN';
    },
    'READ_ONLY_REPEATABLE_READ_NOT_ENFORCED'
  ],
  [
    'BEGIN not acknowledged',
    (f) => {
      f.events[1].ok = false;
    },
    expected.lifecycle
  ],
  [
    'second session injected',
    (f) => {
      f.events[5].sessionId = 'fixture-other-session';
    },
    expected.context
  ],
  [
    'second connection injected',
    (f) => {
      f.events[6].connectionId = 'fixture-another-connection';
    },
    expected.context
  ],
  [
    'second transaction injected',
    (f) => {
      f.events[8].transactionId = 'fixture-another-tx';
    },
    expected.context
  ],
  [
    'second snapshot injected',
    (f) => {
      f.events[10].snapshotId = 'fixture-other-snapshot';
    },
    expected.context
  ],
  [
    'non-fixture session',
    (f) => {
      f.events[3].sessionId = 'real-session';
    },
    expected.context
  ],
  [
    'wrong DB ref',
    (f) => {
      f.events[2].dbRef = PRODUCTION_PROJECT;
    },
    'STAGING_TARGET_INCORRECT'
  ],
  [
    'missing middle SELECT',
    (f) => {
      f.events.splice(4, 1);
    },
    'ONE_OPEN_BEGIN_ELEVEN_SELECTS_ROLLBACK_CLOSE_REQUIRED'
  ],
  [
    'extra SELECT',
    (f) => {
      f.events.splice(10, 0, { ...f.events[8] });
    },
    'ONE_OPEN_BEGIN_ELEVEN_SELECTS_ROLLBACK_CLOSE_REQUIRED'
  ],
  [
    'swapped SELECTs',
    (f) => {
      [f.events[3], f.events[4]] = [f.events[4], f.events[3]];
    },
    expected.selection
  ],
  [
    'wrong SELECT ID',
    (f) => {
      f.events[2].sectionId = 'NL-UNKNOWN-01';
    },
    expected.selection
  ],
  [
    'wrong SELECT order',
    (f) => {
      f.events[5].order = 99;
    },
    expected.selection
  ],
  [
    'statement digest drift',
    (f) => {
      f.events[8].statementDigest = 'f'.repeat(64);
    },
    expected.selection
  ],
  [
    'SELECT SQL failure',
    (f) => {
      f.events[5].status = 'error';
    },
    expected.result
  ],
  [
    'SELECT timeout',
    (f) => {
      f.events[7].status = 'timeout';
    },
    expected.result
  ],
  [
    'SELECT disconnected',
    (f) => {
      f.events[7].status = 'disconnect';
    },
    expected.result
  ],
  [
    'SELECT absent row count',
    (f) => {
      delete f.events[6].rowCount;
    },
    expected.result
  ],
  [
    'SELECT negative row count',
    (f) => {
      f.events[6].rowCount = -1;
    },
    expected.result
  ],
  [
    'SELECT broken digest',
    (f) => {
      f.events[6].resultDigest = 'invalid';
    },
    expected.result
  ],
  [
    'malformed SELECT event',
    (f) => {
      f.events[4] = null;
    },
    'MALFORMED_MOCK_EVENT'
  ],
  [
    'actual SQL text attached',
    (f) => {
      f.events[2].sql = 'SELECT 1';
    },
    'UNSANITIZED_SQL_OR_RESULT_PAYLOAD_FORBIDDEN'
  ],
  [
    'raw result payload attached',
    (f) => {
      f.events[3].resultPayload = ['sensitive'];
    },
    'UNSANITIZED_SQL_OR_RESULT_PAYLOAD_FORBIDDEN'
  ],
  [
    'ROLLBACK missing',
    (f) => {
      f.events[13].action = 'COMMIT';
    },
    expected.lifecycle
  ],
  [
    'ROLLBACK ACK lost',
    (f) => {
      f.events[13].rollbackAck = 'lost';
    },
    'ROLLBACK_UNCERTAIN_DISCARD_ALL'
  ],
  [
    'ROLLBACK ACK unknown',
    (f) => {
      f.events[13].rollbackAck = 'unknown';
    },
    'ROLLBACK_UNCERTAIN_DISCARD_ALL'
  ],
  [
    'CLOSE ACK lost',
    (f) => {
      f.events[14].closeAck = 'lost';
    },
    'CONNECTION_CLOSE_UNCERTAIN_DISCARD_ALL'
  ],
  [
    'COMMIT action substituted',
    (f) => {
      f.events[8].action = 'COMMIT';
    },
    'REAL_SQL_COMMIT_OR_RECONNECT_ACTION_FORBIDDEN'
  ],
  [
    'DML action substituted',
    (f) => {
      f.events[8].action = 'UPDATE';
    },
    'REAL_SQL_COMMIT_OR_RECONNECT_ACTION_FORBIDDEN'
  ],
  [
    'reconnect action substituted',
    (f) => {
      f.events[8].action = 'RECONNECT';
    },
    'REAL_SQL_COMMIT_OR_RECONNECT_ACTION_FORBIDDEN'
  ],
  [
    'transport marked real',
    (f) => {
      f.transport.kind = 'POSTGRES';
    },
    expected.transport
  ],
  [
    'second attempt',
    (f) => {
      f.transport.attempt = 2;
    },
    expected.transport
  ],
  [
    'reconnect count positive',
    (f) => {
      f.transport.reconnects = 1;
    },
    expected.transport
  ],
  [
    'auto retry requested',
    (f) => {
      f.transport.autoRetry = true;
    },
    expected.transport
  ],
  [
    'legacy owner scope',
    (f) => {
      f.owner.request.scope =
        'reader-reward-beta-point-10x-staging-catalog-readonly';
    },
    'OWNER_SCOPE_OR_REQUEST_CONTRACT_MISMATCH'
  ],
  [
    'wrong owner issue',
    (f) => {
      f.owner.request.issueNumber = 123;
    },
    'OWNER_SCOPE_OR_REQUEST_CONTRACT_MISMATCH'
  ],
  [
    'wrong owner operation',
    (f) => {
      f.owner.request.operation = 'mutation';
    },
    'OWNER_SCOPE_OR_REQUEST_CONTRACT_MISMATCH'
  ],
  [
    'owner main SHA stale',
    (f) => {
      f.owner.request.mainSha = 'd'.repeat(40);
    },
    'STALE_OWNER_MAIN_OR_HEAD_BINDING'
  ],
  [
    'owner HEAD SHA stale',
    (f) => {
      f.owner.request.headSha = 'd'.repeat(40);
    },
    'STALE_OWNER_MAIN_OR_HEAD_BINDING'
  ],
  [
    'owner impersonation flag',
    (f) => {
      f.owner.authenticated = true;
    },
    'CALLER_ASSERTED_OWNER_AUTHORITY'
  ],
  [
    'owner approval impersonation',
    (f) => {
      f.owner.approved = true;
    },
    'CALLER_ASSERTED_OWNER_AUTHORITY'
  ],
  [
    'control owner ID mismatch',
    (f) => {
      f.control.commentId += 1;
    },
    'OWNER_CONTROL_COMMENT_ID_MISMATCH'
  ],
  [
    'control already spent',
    (f) => {
      f.control.state.spent = [f.control.commentId];
    },
    'CONTROL_CAS_CONFLICT_OR_STALE_EPOCH'
  ],
  [
    'control active owner',
    (f) => {
      f.control.state.active = 42;
    },
    'CONTROL_CAS_CONFLICT_OR_STALE_EPOCH'
  ],
  [
    'control stale version',
    (f) => {
      f.control.state.version = 1;
    },
    'CONTROL_CAS_CONFLICT_OR_STALE_EPOCH'
  ],
  [
    'control stale epoch',
    (f) => {
      f.control.state.epoch = 1;
    },
    'CONTROL_CAS_CONFLICT_OR_STALE_EPOCH'
  ],
  [
    'control uncertain previous commit',
    (f) => {
      f.control.state.commitUnknown = true;
    },
    'CONTROL_CAS_CONFLICT_OR_STALE_EPOCH'
  ],
  [
    'control commit ACK lost',
    (f) => {
      f.control.commitAck = 'lost';
    },
    'CONTROL_COMMIT_ACK_UNKNOWN_NO_RETRY'
  ],
  [
    'control commit ACK unknown',
    (f) => {
      f.control.commitAck = 'unknown';
    },
    'CONTROL_COMMIT_ACK_UNKNOWN_NO_RETRY'
  ],
  [
    'fake durable control',
    (f) => {
      f.control.durable = true;
    },
    'INERT_CONTROL_CANNOT_CLAIM_DURABILITY'
  ],
  [
    'fake claimed control',
    (f) => {
      f.control.claimed = true;
    },
    'INERT_CONTROL_CANNOT_CLAIM_DURABILITY'
  ],
  [
    'unknown privileged route',
    (f) => {
      f.privileges.unknownPaths = ['unknown-SECDEF-path'];
    },
    expected.privilege
  ],
  [
    'privileged coverage incomplete',
    (f) => {
      f.privileges.coveredSections.pop();
    },
    expected.privilege
  ],
  [
    'privileged coverage swapped',
    (f) => {
      f.privileges.coveredSections.reverse();
    },
    expected.privilege
  ],
  [
    'privileged schema false',
    (f) => {
      f.privileges.schemaValid = false;
    },
    expected.privilege
  ],
  [
    'privileged digests false',
    (f) => {
      f.privileges.digestsValid = false;
    },
    expected.privilege
  ],
  [
    'privileged evidence claims real',
    (f) => {
      f.privileges.evidenceKind = 'REAL';
    },
    expected.privilege
  ]
];
for (const [name, mutate, reason] of cases) {
  test('fail-closed: ' + name, () => bad(mutate, reason));
}
test('CAS is only a simulation: second reuse of already claimed mock state fails', () => {
  const f = clone();
  f.control.state.spent = [f.owner.request.commentId];
  const r = replay(f);
  assert.equal(r.status, 'HOLD_OFFLINE_MOCK');
  assert.ok(r.blockers.includes('CONTROL_CAS_CONFLICT_OR_STALE_EPOCH'));
  noLiveAuthority(r);
});
test('completely fabricated GO result cannot be supplied as privilege evidence', () => {
  const f = clone();
  f.privileges.decision = 'GO';
  const r = replay(f);
  assert.equal(r.decision, 'NO_GO');
  noLiveAuthority(r);
});
test('all canonical fixtures remain NO-GO regardless of synthetic success', () => {
  for (let i = 0; i < 4; i++) good();
  assert.equal(
    SNAPSHOT_PLAN_SCOPE,
    'reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly'
  );
});
