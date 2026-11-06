import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import {
  THREAT_MODEL_PROTOCOL,
  PROVENANCE_PROTOCOL,
  CAS_PROTOCOL,
  FENCE_PROTOCOL,
  OWNER_PROVENANCE_REQUIREMENTS,
  EXPECTED_CAS_PARTS,
  FENCE_REQUIRED_CLASSES,
  FENCE_REQUIRED_PRIVILEGED_PATHS,
  makeGoodOwnerProvenanceFixture,
  reviewInertOwnerProvenance,
  makeGoodCasThreatFixture,
  reviewInertCasThreat,
  modelInertCasRace,
  makeGoodFenceThreatFixture,
  reviewInertWriterFenceThreat,
  reviewCombinedInertThreats
} from '../scripts/scout-point10x-owner-cas-writer-threat-review.mjs';
import {
  REQUIRED_FAIL_CLOSED,
  SNAPSHOT_PLAN_SCOPE,
  SNAPSHOT_TXN_BOUNDARY
} from '../scripts/scout-point10x-single-snapshot-review.mjs';
import {
  SINGLE_USE_CONSTRAINTS,
  REQUIRED_PRIVILEGED_PATHS
} from '../scripts/scout-point10x-cas-fencing-handoff-model.mjs';
import { MUTATION_DOMAIN } from '../scripts/scout-point10x-durable-fence-model.mjs';
import { SCOUT_POINT_10X_WRITER_CLASSES } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const owner = () => clone(makeGoodOwnerProvenanceFixture());
const cas = () => clone(makeGoodCasThreatFixture());
const fence = () => clone(makeGoodFenceThreatFixture());
const combined = () => ({ owner: owner(), cas: cas(), fence: fence() });
function denyLive(r) {
  assert.equal(r.decision, 'NO_GO');
  assert.equal(r.proofType, 'UNTRUSTED_SYNTHETIC_SOURCE_ONLY');
  assert.equal(r.syntheticEvidenceOnly, true);
  for (const key of [
    'authenticatedOwner',
    'ownerApprovalRegistered',
    'actualControlClaimed',
    'actualSpentConsumed',
    'actualWriterFenced',
    'writerDrainRealVerified',
    'singleRealSnapshotVerified',
    'actualCatalogCompared',
    'realSqlExecuted',
    'mayIssueApproval',
    'mayClaimOwner',
    'mayWriteIssue294',
    'mayConnectDb',
    'mayReadSecrets',
    'mayRunSql',
    'mayWriteDb',
    'mayUseDocker',
    'mayRunStaging',
    'mayChangeProduction',
    'mayMergeMain',
    'mayDeploy',
    'mayRetryAutomatically',
    'mayReleaseFence',
    'mayResumeWriters'
  ])
    assert.equal(r[key], false, key);
  assert.equal(r.realDatabaseConnections, 0);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.blockers));
  for (const code of REQUIRED_FAIL_CLOSED)
    assert.ok(r.blockers.includes(code), 'base blocker ' + code);
}
function good(r, status) {
  assert.equal(r.status, status, r.blockers.join(','));
  assert.equal(r.modelInvariantPass, true);
  assert.equal(r.partialEvidenceDiscarded, false);
  denyLive(r);
}
function blocked(r, code) {
  assert.match(r.status, /^HOLD_INERT_/u);
  assert.equal(r.modelInvariantPass, false);
  assert.equal(r.partialEvidenceDiscarded, true);
  assert.ok(r.blockers.includes(code), code + ': ' + r.blockers.join(','));
  denyLive(r);
}
function runNegative(make, review, name, mutate, code) {
  test(name, () => {
    const f = make();
    mutate(f);
    blocked(review({ fixture: f }), code);
  });
}
test('manifest, schemas, immutable source categories and zero live authority', () => {
  assert.equal(THREAT_MODEL_PROTOCOL, 'POINT10X_SOURCE_ONLY_THREAT_REVIEW_V1');
  assert.equal(PROVENANCE_PROTOCOL, 'POINT10X_SYNTHETIC_OWNER_EVENT_V1');
  assert.equal(CAS_PROTOCOL, 'POINT10X_SYNTHETIC_CONTROL_CAS_V1');
  assert.equal(FENCE_PROTOCOL, 'POINT10X_SYNTHETIC_DATA_PLANE_FENCE_V1');
  assert.equal(OWNER_PROVENANCE_REQUIREMENTS.length, 6);
  assert.equal(EXPECTED_CAS_PARTS.length, 4);
  assert.deepEqual([...FENCE_REQUIRED_CLASSES], SCOUT_POINT_10X_WRITER_CLASSES);
  assert.deepEqual(
    [...FENCE_REQUIRED_PRIVILEGED_PATHS],
    REQUIRED_PRIVILEGED_PATHS
  );
  assert.equal(FENCE_REQUIRED_CLASSES.length, 9);
  assert.equal(FENCE_REQUIRED_PRIVILEGED_PATHS.length, 5);
  assert.equal(SINGLE_USE_CONSTRAINTS.length, 6);
  assert.equal(MUTATION_DOMAIN, 'issue294-point10x-all-staging-writers');
  good(
    reviewInertOwnerProvenance({ fixture: owner() }),
    'NO_GO_INERT_OWNER_PROVENANCE'
  );
  good(reviewInertCasThreat({ fixture: cas() }), 'NO_GO_INERT_CONTROL_CAS');
  good(
    reviewInertWriterFenceThreat({ fixture: fence() }),
    'NO_GO_INERT_DATA_PLANE_FENCE'
  );
  good(reviewCombinedInertThreats(combined()), 'NO_GO_INERT_COMBINED');
});
test('8+3 immutable SQL byte SHA pins are unchanged', () => {
  for (const [file, expected] of [
    [
      '../docs/plans/READER-REWARD-POINT10X-STAGING-CATALOG-READONLY-20261105.sql',
      SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.base
    ],
    [
      '../docs/plans/READER-REWARD-POINT10X-STAGING-PRIVILEGED-CATALOG-ADDENDUM-20261105.sql',
      SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.addendum
    ]
  ]) {
    const bytes = readFileSync(fileURLToPath(new URL(file, import.meta.url)));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
  }
});
test('no adapters or driver callbacks are executed', () => {
  const e = owner();
  e.performDbSelect = () => {
    throw Error('MUST_NOT_EXECUTE');
  };
  blocked(
    reviewInertOwnerProvenance({ fixture: e }),
    'OWNER_EVENT_INPUT_OR_ORIGIN_UNTRUSTED'
  );
  const c = cas();
  c.executeSql = () => {
    throw Error('MUST_NOT_EXECUTE');
  };
  blocked(
    reviewInertCasThreat({ fixture: c }),
    'CALLER_SIMULATION_CANNOT_ASSERT_DURABLE_STORAGE'
  );
  const f = fence();
  f.releaseWriters = () => {
    throw Error('MUST_NOT_EXECUTE');
  };
  blocked(
    reviewInertWriterFenceThreat({ fixture: f }),
    'UNTRUSTED_FENCE_SOURCE_OR_EXTRA_FIELDS'
  );
});
const ownerThreats = [
  [
    'missing protocol',
    (f) => {
      f.protocol = 'OWNER_APPROVED';
    },
    'OWNER_PROVENANCE_PROTOCOL_REQUIRED'
  ],
  [
    'root token injected',
    (f) => {
      f.authorization = 'Bearer forbidden';
    },
    'OWNER_EVENT_INPUT_OR_ORIGIN_UNTRUSTED'
  ],
  [
    'forged real GitHub origin',
    (f) => {
      f.source = 'LIVE_GITHUB_API';
    },
    'OWNER_EVENT_INPUT_OR_ORIGIN_UNTRUSTED'
  ],
  [
    'owner impersonation',
    (f) => {
      f.event.author = 'other-user';
    },
    'FORGED_OWNER_ACTOR_REPO_OR_EVENT_ORIGIN'
  ],
  [
    'bot comment as owner',
    (f) => {
      f.event.authorType = 'Bot';
    },
    'FORGED_OWNER_ACTOR_REPO_OR_EVENT_ORIGIN'
  ],
  [
    'delegated owner event',
    (f) => {
      f.event.isBotOrDelegate = true;
    },
    'FORGED_OWNER_ACTOR_REPO_OR_EVENT_ORIGIN'
  ],
  [
    'wrong repository',
    (f) => {
      f.event.repo = 'another/repo';
    },
    'FORGED_OWNER_ACTOR_REPO_OR_EVENT_ORIGIN'
  ],
  [
    'wrong issue',
    (f) => {
      f.event.issueNumber = 1837;
    },
    'FORGED_OWNER_ACTOR_REPO_OR_EVENT_ORIGIN'
  ],
  [
    'wrong issue title',
    (f) => {
      f.event.issueTitle = 'Changed';
    },
    'FORGED_OWNER_ACTOR_REPO_OR_EVENT_ORIGIN'
  ],
  [
    'wrong event kind',
    (f) => {
      f.event.eventKind = 'pull_request';
    },
    'FORGED_OWNER_ACTOR_REPO_OR_EVENT_ORIGIN'
  ],
  [
    'synth event claims webhook verification',
    (f) => {
      f.event.eventOrigin = 'AUTHENTICATED_GITHUB';
    },
    'FORGED_OWNER_ACTOR_REPO_OR_EVENT_ORIGIN'
  ],
  [
    'claims real signature',
    (f) => {
      f.event.signatureStatus = 'VERIFIED';
    },
    'FORGED_OWNER_ACTOR_REPO_OR_EVENT_ORIGIN'
  ],
  [
    'approval marker forged',
    (f) => {
      f.event.approvalMarker = 'APPROVED';
    },
    'FORGED_OWNER_ACTOR_REPO_OR_EVENT_ORIGIN'
  ],
  [
    'invalid comment ID',
    (f) => {
      f.event.commentId = 0;
    },
    'FORGED_OWNER_ACTOR_REPO_OR_EVENT_ORIGIN'
  ],
  [
    'edited event',
    (f) => {
      f.event.edited = true;
    },
    'STALE_EDITED_DELETED_OR_EXPIRED_OWNER_EVENT'
  ],
  [
    'deleted event',
    (f) => {
      f.event.deleted = true;
    },
    'STALE_EDITED_DELETED_OR_EXPIRED_OWNER_EVENT'
  ],
  [
    'expired event',
    (f) => {
      f.event.observedAt = '2026-11-06T00:00:00Z';
    },
    'STALE_EDITED_DELETED_OR_EXPIRED_OWNER_EVENT'
  ],
  [
    'reversed event times',
    (f) => {
      f.event.createdAt = '2026-11-06T02:00:00Z';
    },
    'STALE_EDITED_DELETED_OR_EXPIRED_OWNER_EVENT'
  ],
  [
    'invalid time format',
    (f) => {
      f.event.expiresAt = 'bad-time';
    },
    'STALE_EDITED_DELETED_OR_EXPIRED_OWNER_EVENT'
  ],
  [
    'wrong scope reuse',
    (f) => {
      f.request.scope = 'reader-reward-beta-point-10x-staging-catalog-readonly';
    },
    'OWNER_REQUEST_NOT_EXACTLY_SCOPE_BOUND'
  ],
  [
    'wrong operation',
    (f) => {
      f.request.operation = 'mutate-points';
    },
    'OWNER_REQUEST_NOT_EXACTLY_SCOPE_BOUND'
  ],
  [
    'wrong SQL hash',
    (f) => {
      f.request.originalSqlDigests.addendum = '0'.repeat(64);
    },
    'OWNER_REQUEST_NOT_EXACTLY_SCOPE_BOUND'
  ],
  [
    'wrong plan hash',
    (f) => {
      f.request.planDigest = '0'.repeat(64);
    },
    'OWNER_REQUEST_NOT_EXACTLY_SCOPE_BOUND'
  ],
  [
    'request author authority asserted',
    (f) => {
      f.request.approved = true;
    },
    'OWNER_REQUEST_NOT_EXACTLY_SCOPE_BOUND'
  ],
  [
    'request comment mismatches event',
    (f) => {
      f.event.commentId = 735002;
    },
    'OWNER_REQUEST_NOT_EXACTLY_SCOPE_BOUND'
  ],
  [
    'fresh main drift',
    (f) => {
      f.fresh.mainSha = 'c'.repeat(40);
    },
    'OWNER_FRESH_MAIN_HEAD_OR_TARGET_MISMATCH'
  ],
  [
    'fresh head drift',
    (f) => {
      f.fresh.headSha = 'd'.repeat(40);
    },
    'OWNER_FRESH_MAIN_HEAD_OR_TARGET_MISMATCH'
  ],
  [
    'fresh plan drift',
    (f) => {
      f.fresh.planDigest = 'f'.repeat(64);
    },
    'OWNER_FRESH_MAIN_HEAD_OR_TARGET_MISMATCH'
  ],
  [
    'fresh production target drift',
    (f) => {
      f.fresh.stagingRef = 'not-staging';
    },
    'OWNER_FRESH_MAIN_HEAD_OR_TARGET_MISMATCH'
  ],
  [
    'different draft PR',
    (f) => {
      f.fresh.draftPrNumber = 2763;
    },
    'OWNER_FRESH_MAIN_HEAD_OR_TARGET_MISMATCH'
  ],
  [
    'missing issue page',
    (f) => {
      f.history.paginationCompleteInFixture = false;
    },
    'ISSUE_HISTORY_REPLAY_OR_UNKNOWN_EVENT'
  ],
  [
    'duplicate comment ID',
    (f) => {
      f.history.duplicateIds = [735001];
    },
    'ISSUE_HISTORY_REPLAY_OR_UNKNOWN_EVENT'
  ],
  [
    'previous CLAIMED',
    (f) => {
      f.history.claimedIds = [735001];
    },
    'ISSUE_HISTORY_REPLAY_OR_UNKNOWN_EVENT'
  ],
  [
    'previous CONSUMED',
    (f) => {
      f.history.consumedIds = [735001];
    },
    'ISSUE_HISTORY_REPLAY_OR_UNKNOWN_EVENT'
  ],
  [
    'unknown ledger marker',
    (f) => {
      f.history.unknownMarkers = ['UNKNOWN'];
    },
    'ISSUE_HISTORY_REPLAY_OR_UNKNOWN_EVENT'
  ],
  [
    'competing scope HEAD',
    (f) => {
      f.history.competingScopeHeadIds = [42];
    },
    'ISSUE_HISTORY_REPLAY_OR_UNKNOWN_EVENT'
  ],
  [
    'missing request in history',
    (f) => {
      f.history.requestSeenOnce = false;
    },
    'ISSUE_HISTORY_REPLAY_OR_UNKNOWN_EVENT'
  ],
  [
    'fabricated complete proof',
    (f) => {
      f.history.kind = 'AUTHORITATIVE_GITHUB';
    },
    'ISSUE_HISTORY_REPLAY_OR_UNKNOWN_EVENT'
  ]
];
for (const [name, fn, code] of ownerThreats)
  runNegative(
    owner,
    reviewInertOwnerProvenance,
    'OWNER threat: ' + name,
    fn,
    code
  );
test('malformed provenance inputs never create authority', () => {
  blocked(
    reviewInertOwnerProvenance({ fixture: null }),
    'OWNER_PROVENANCE_PROTOCOL_REQUIRED'
  );
  for (const k of ['event', 'request', 'fresh', 'history']) {
    const f = owner();
    f[k] = null;
    assert.doesNotThrow(() => reviewInertOwnerProvenance({ fixture: f }));
    denyLive(reviewInertOwnerProvenance({ fixture: f }));
  }
});

const casThreats = [
  [
    'missing protocol',
    (f) => {
      f.protocol = 'LIVE';
    },
    'CONTROL_CAS_PROTOCOL_REQUIRED'
  ],
  [
    'injected credentials',
    (f) => {
      f.secrets = 'never';
    },
    'CALLER_SIMULATION_CANNOT_ASSERT_DURABLE_STORAGE'
  ],
  [
    'false durable storage claim',
    (f) => {
      f.storage = 'POSTGRES_PRIMARY';
    },
    'CALLER_SIMULATION_CANNOT_ASSERT_DURABLE_STORAGE'
  ],
  [
    'wrong scope',
    (f) => {
      f.request.scope = 'old-scope';
    },
    'CAS_REQUEST_ID_SCOPE_OR_SHA_INVALID'
  ],
  [
    'bad comment ID',
    (f) => {
      f.request.commentId = -1;
    },
    'CAS_REQUEST_ID_SCOPE_OR_SHA_INVALID'
  ],
  [
    'bad operation ID',
    (f) => {
      f.request.operationId = 'x';
    },
    'CAS_REQUEST_ID_SCOPE_OR_SHA_INVALID'
  ],
  [
    'bad main sha',
    (f) => {
      f.request.mainSha = 'wrong';
    },
    'CAS_REQUEST_ID_SCOPE_OR_SHA_INVALID'
  ],
  [
    'bad HEAD sha',
    (f) => {
      f.request.headSha = 'wrong';
    },
    'CAS_REQUEST_ID_SCOPE_OR_SHA_INVALID'
  ],
  [
    'foreign domain',
    (f) => {
      f.observed.domain = 'wrong';
    },
    'CAS_PRIMARY_SNAPSHOT_UNSAFE_OR_AMBIGUOUS'
  ],
  [
    'invalid revision',
    (f) => {
      f.observed.version = -1;
    },
    'CAS_PRIMARY_SNAPSHOT_UNSAFE_OR_AMBIGUOUS'
  ],
  [
    'active competing claim',
    (f) => {
      f.observed.active = { owner: 2 };
    },
    'CAS_PRIMARY_SNAPSHOT_UNSAFE_OR_AMBIGUOUS'
  ],
  [
    'uncertain prior commit',
    (f) => {
      f.observed.commitUncertain = true;
    },
    'CAS_PRIMARY_SNAPSHOT_UNSAFE_OR_AMBIGUOUS'
  ],
  [
    'already spent comment',
    (f) => {
      f.observed.spentComments = [735001];
    },
    'CAS_ALREADY_SPENT_OR_DUPLICATE_SCOPE_HEAD'
  ],
  [
    'already spent operation',
    (f) => {
      f.observed.spentOperations = [f.request.operationId];
    },
    'CAS_ALREADY_SPENT_OR_DUPLICATE_SCOPE_HEAD'
  ],
  [
    'same scope and head spent',
    (f) => {
      f.observed.spentScopeHeads = [f.request.scope + '@' + f.request.headSha];
    },
    'CAS_ALREADY_SPENT_OR_DUPLICATE_SCOPE_HEAD'
  ],
  [
    'CAS expected version stale',
    (f) => {
      f.proposal.expectedVersion = 7;
    },
    'CAS_STALE_REVISION_EPOCH_OR_OVERFLOW'
  ],
  [
    'CAS expected epoch stale',
    (f) => {
      f.proposal.expectedEpoch = 11;
    },
    'CAS_STALE_REVISION_EPOCH_OR_OVERFLOW'
  ],
  [
    'next epoch reused',
    (f) => {
      f.proposal.nextEpoch = 12;
    },
    'CAS_STALE_REVISION_EPOCH_OR_OVERFLOW'
  ],
  [
    'next version reused',
    (f) => {
      f.proposal.nextVersion = 8;
    },
    'CAS_STALE_REVISION_EPOCH_OR_OVERFLOW'
  ],
  [
    'epoch overflows',
    (f) => {
      f.observed.epoch = Number.MAX_SAFE_INTEGER;
      f.proposal.expectedEpoch = Number.MAX_SAFE_INTEGER;
      f.proposal.nextEpoch = Number.MAX_SAFE_INTEGER + 1;
    },
    'CAS_STALE_REVISION_EPOCH_OR_OVERFLOW'
  ],
  [
    'non-atomic transaction',
    (f) => {
      f.proposal.transaction = 'MULTI_STEP';
    },
    'CAS_ATOMIC_SPENT_EPOCH_OR_UNIQUE_KEYS_NOT_MODELLED'
  ],
  [
    'weakened serializability',
    (f) => {
      f.proposal.isolation = 'READ COMMITTED';
    },
    'CAS_ATOMIC_SPENT_EPOCH_OR_UNIQUE_KEYS_NOT_MODELLED'
  ],
  [
    'missing tombstone',
    (f) => {
      f.proposal.parts.splice(1, 1);
    },
    'CAS_ATOMIC_SPENT_EPOCH_OR_UNIQUE_KEYS_NOT_MODELLED'
  ],
  [
    'wrong CAS order',
    (f) => {
      f.proposal.parts.reverse();
    },
    'CAS_ATOMIC_SPENT_EPOCH_OR_UNIQUE_KEYS_NOT_MODELLED'
  ],
  [
    'missing unique constraint',
    (f) => {
      f.proposal.uniqueConstraints.pop();
    },
    'CAS_ATOMIC_SPENT_EPOCH_OR_UNIQUE_KEYS_NOT_MODELLED'
  ],
  [
    'tombstone erasable',
    (f) => {
      f.proposal.tombstone = 'DELETE_ON_FAILURE';
    },
    'CAS_ATOMIC_SPENT_EPOCH_OR_UNIQUE_KEYS_NOT_MODELLED'
  ],
  [
    'one-time claim missing',
    (f) => {
      f.proposal.claimedOneTime = false;
    },
    'CAS_ATOMIC_SPENT_EPOCH_OR_UNIQUE_KEYS_NOT_MODELLED'
  ],
  [
    'writer unlock attempt',
    (f) => {
      f.proposal.unlockWriters = true;
    },
    'CAS_ATOMIC_SPENT_EPOCH_OR_UNIQUE_KEYS_NOT_MODELLED'
  ],
  [
    'fake authoritative readback',
    (f) => {
      f.proposal.readback = 'REAL_VERIFIED';
    },
    'CAS_ATOMIC_SPENT_EPOCH_OR_UNIQUE_KEYS_NOT_MODELLED'
  ],
  [
    'ack lost',
    (f) => {
      f.proposal.commitAck = 'lost';
    },
    'CAS_COMMIT_AMBIGUOUS_MUST_HOLD_READBACK'
  ],
  [
    'ack unknown',
    (f) => {
      f.proposal.commitAck = 'unknown';
    },
    'CAS_COMMIT_AMBIGUOUS_MUST_HOLD_READBACK'
  ],
  [
    'second attempt',
    (f) => {
      f.proposal.attempt = 2;
    },
    'CAS_RETRY_OR_SECOND_ATTEMPT_FORBIDDEN'
  ],
  [
    'automatic retry',
    (f) => {
      f.proposal.retryOnUnknown = true;
    },
    'CAS_RETRY_OR_SECOND_ATTEMPT_FORBIDDEN'
  ]
];
for (const [name, fn, code] of casThreats)
  runNegative(cas, reviewInertCasThreat, 'CAS threat: ' + name, fn, code);
test('CAS uncertain commit always requires authoritative external readback', () => {
  const f = cas();
  f.proposal.commitAck = 'lost';
  const out = reviewInertCasThreat({ fixture: f });
  blocked(out, 'CAS_COMMIT_AMBIGUOUS_MUST_HOLD_READBACK');
  assert.equal(out.authoritativeReadbackRequired, true);
  assert.equal(out.mayRetryAutomatically, false);
});
test('invalid CAS fixture must be fail-closed', () => {
  blocked(
    reviewInertCasThreat({ fixture: null }),
    'CONTROL_CAS_PROTOCOL_REQUIRED'
  );
  for (const name of ['request', 'observed', 'proposal']) {
    const f = cas();
    f[name] = null;
    assert.doesNotThrow(() => reviewInertCasThreat({ fixture: f }));
    denyLive(reviewInertCasThreat({ fixture: f }));
  }
});
const raceState = () => ({
  domain: MUTATION_DOMAIN,
  version: 8,
  epoch: 12,
  active: null,
  spent: [],
  uncertain: false
});
const raceContenders = () => [
  {
    commentId: 735001,
    operationId: 'fixture-point10x-run01',
    headSha: 'b'.repeat(40),
    expectedVersion: 8,
    expectedEpoch: 12
  },
  {
    commentId: 735002,
    operationId: 'fixture-point10x-run02',
    headSha: 'b'.repeat(40),
    expectedVersion: 8,
    expectedEpoch: 12
  }
];
test('two concurrent contenders cannot both win even in synthetic CAS race', () => {
  const out = modelInertCasRace({
    state: raceState(),
    contenders: raceContenders()
  });
  good(out, 'NO_GO_INERT_CAS_RACE');
  assert.equal(out.hypotheticalWinnerCount, 1);
  assert.equal(out.hypotheticalRejectedConcurrentCount, 1);
  assert.equal(out.noRealSerializabilityProof, true);
});
const raceThreats = [
  [
    'dirty state',
    (s) => {
      s.active = { claim: 1 };
    },
    null,
    'RACE_STATE_NOT_CLEAN'
  ],
  [
    'uncertain previous CAS',
    (s) => {
      s.uncertain = true;
    },
    null,
    'RACE_STATE_NOT_CLEAN'
  ],
  [
    'stale contender epoch',
    null,
    (c) => {
      c[1].expectedEpoch = 11;
    },
    'TWO_VALID_SAME_REVISION_CONTENDERS_REQUIRED'
  ],
  [
    'stale contender version',
    null,
    (c) => {
      c[1].expectedVersion = 7;
    },
    'TWO_VALID_SAME_REVISION_CONTENDERS_REQUIRED'
  ],
  [
    'missing contender',
    null,
    (c) => {
      c.pop();
    },
    'TWO_VALID_SAME_REVISION_CONTENDERS_REQUIRED'
  ],
  [
    'duplicate id',
    null,
    (c) => {
      c[1].commentId = c[0].commentId;
    },
    'DUPLICATE_CONTENDER_IDENTITY'
  ],
  [
    'duplicate operation',
    null,
    (c) => {
      c[1].operationId = c[0].operationId;
    },
    'DUPLICATE_CONTENDER_IDENTITY'
  ],
  [
    'spent contender',
    (s) => {
      s.spent = [735001];
    },
    null,
    'SPENT_CONTENDER_REPLAY'
  ]
];
for (const [name, sMut, cMut, reason] of raceThreats)
  test('CAS race: ' + name, () => {
    const s = raceState(),
      c = raceContenders();
    sMut?.(s);
    cMut?.(c);
    blocked(modelInertCasRace({ state: s, contenders: c }), reason);
  });
test('CAS race malformed state cannot impersonate an executor', () => {
  blocked(
    modelInertCasRace({ state: null, contenders: null }),
    'RACE_STATE_NOT_CLEAN'
  );
});

const fenceThreats = [
  [
    'wrong protocol',
    (f) => {
      f.protocol = 'LIVE';
    },
    'WRITER_FENCE_PROTOCOL_REQUIRED'
  ],
  [
    'remote proof assertion',
    (f) => {
      f.source = 'STAGING_VERIFIED';
    },
    'UNTRUSTED_FENCE_SOURCE_OR_EXTRA_FIELDS'
  ],
  [
    'extra credential',
    (f) => {
      f.dbPassword = 'never';
    },
    'UNTRUSTED_FENCE_SOURCE_OR_EXTRA_FIELDS'
  ],
  [
    'wrong domain',
    (f) => {
      f.control.domain = 'another';
    },
    'FENCE_EPOCH_LEASE_OR_COMMIT_UNSAFE'
  ],
  [
    'reused epoch',
    (f) => {
      f.control.epoch = 12;
    },
    'FENCE_EPOCH_LEASE_OR_COMMIT_UNSAFE'
  ],
  [
    'past epoch',
    (f) => {
      f.control.priorEpoch = 15;
    },
    'FENCE_EPOCH_LEASE_OR_COMMIT_UNSAFE'
  ],
  [
    'two leases',
    (f) => {
      f.control.writeLease = 'MULTIPLE';
    },
    'FENCE_EPOCH_LEASE_OR_COMMIT_UNSAFE'
  ],
  [
    'control commit unknown',
    (f) => {
      f.control.commitAck = 'unknown';
    },
    'FENCE_EPOCH_LEASE_OR_COMMIT_UNSAFE'
  ],
  [
    'writers released',
    (f) => {
      f.control.writerReleaseAllowed = true;
    },
    'FENCE_EPOCH_LEASE_OR_COMMIT_UNSAFE'
  ],
  [
    'missing writer class',
    (f) => {
      f.writers.pop();
    },
    'NINE_WRITER_CLASSES_NOT_FENCED_AND_DRAINED'
  ],
  [
    'writer order drift',
    (f) => {
      f.writers.reverse();
    },
    'NINE_WRITER_CLASSES_NOT_FENCED_AND_DRAINED'
  ],
  [
    'writer category substituted',
    (f) => {
      f.writers[2].kind = 'unknown';
    },
    'NINE_WRITER_CLASSES_NOT_FENCED_AND_DRAINED'
  ],
  [
    'old token accepted',
    (f) => {
      f.writers[1].oldEpochDeniedInFixture = false;
    },
    'NINE_WRITER_CLASSES_NOT_FENCED_AND_DRAINED'
  ],
  [
    'writer not blocked',
    (f) => {
      f.writers[3].blockedInFixture = false;
    },
    'NINE_WRITER_CLASSES_NOT_FENCED_AND_DRAINED'
  ],
  [
    'writer stale epoch',
    (f) => {
      f.writers[4].observedEpoch = 12;
    },
    'NINE_WRITER_CLASSES_NOT_FENCED_AND_DRAINED'
  ],
  [
    'inflight write',
    (f) => {
      f.writers[5].pending = 1;
    },
    'NINE_WRITER_CLASSES_NOT_FENCED_AND_DRAINED'
  ],
  [
    'queued write',
    (f) => {
      f.writers[6].queued = 2;
    },
    'NINE_WRITER_CLASSES_NOT_FENCED_AND_DRAINED'
  ],
  [
    'unacked worker',
    (f) => {
      f.writers[7].unacknowledged = 1;
    },
    'NINE_WRITER_CLASSES_NOT_FENCED_AND_DRAINED'
  ],
  [
    'extra writer field',
    (f) => {
      f.writers[0].superuser = true;
    },
    'NINE_WRITER_CLASSES_NOT_FENCED_AND_DRAINED'
  ],
  [
    'privileged path missing',
    (f) => {
      f.privileged.pop();
    },
    'FIVE_PRIVILEGED_PATHS_NOT_FENCED'
  ],
  [
    'privileged path order drift',
    (f) => {
      f.privileged.reverse();
    },
    'FIVE_PRIVILEGED_PATHS_NOT_FENCED'
  ],
  [
    'legacy SECURITY DEFINER bypass',
    (f) => {
      f.privileged[0].canBypass = true;
    },
    'FIVE_PRIVILEGED_PATHS_NOT_FENCED'
  ],
  [
    'service_role DML bypass',
    (f) => {
      f.privileged[1].blockedInFixture = false;
    },
    'FIVE_PRIVILEGED_PATHS_NOT_FENCED'
  ],
  [
    'trigger owner role bypass',
    (f) => {
      f.privileged[2].canBypass = true;
    },
    'FIVE_PRIVILEGED_PATHS_NOT_FENCED'
  ],
  [
    'cron queue retry bypass',
    (f) => {
      f.privileged[3].canBypass = true;
    },
    'FIVE_PRIVILEGED_PATHS_NOT_FENCED'
  ],
  [
    'future writer asserted covered',
    (f) => {
      f.privileged[4].aclVerifiedLive = true;
    },
    'FIVE_PRIVILEGED_PATHS_NOT_FENCED'
  ],
  [
    'unknown writer',
    (f) => {
      f.unknownWriters = ['unknown_rpc'];
    },
    'UNKNOWN_OR_FUTURE_WRITER_PATH_UNRESOLVED'
  ],
  [
    'superuser bypass false proof',
    (f) => {
      f.externalControls.ddlSuperuserBypassClosedLive = true;
    },
    'UNTRUSTED_LIVE_FENCE_OR_BACKUP_ASSERTION'
  ],
  [
    'service_role false proof',
    (f) => {
      f.externalControls.serviceRoleDmlDeniedLive = true;
    },
    'UNTRUSTED_LIVE_FENCE_OR_BACKUP_ASSERTION'
  ],
  [
    'real backup false proof',
    (f) => {
      f.externalControls.backupRestoreVerifiedLive = true;
    },
    'UNTRUSTED_LIVE_FENCE_OR_BACKUP_ASSERTION'
  ],
  [
    'secret read enabled',
    (f) => {
      f.externalControls.role = 'POSTGRES_ADMIN';
    },
    'UNTRUSTED_LIVE_FENCE_OR_BACKUP_ASSERTION'
  ]
];
for (const [name, fn, code] of fenceThreats)
  runNegative(
    fence,
    reviewInertWriterFenceThreat,
    'fence threat: ' + name,
    fn,
    code
  );
test('every one of the 9 writers and 5 privileged routes is a required gate', () => {
  for (let i = 0; i < 9; i++) {
    const f = fence();
    f.writers.splice(i, 1);
    blocked(
      reviewInertWriterFenceThreat({ fixture: f }),
      'NINE_WRITER_CLASSES_NOT_FENCED_AND_DRAINED'
    );
  }
  for (let i = 0; i < 5; i++) {
    const f = fence();
    f.privileged.splice(i, 1);
    blocked(
      reviewInertWriterFenceThreat({ fixture: f }),
      'FIVE_PRIVILEGED_PATHS_NOT_FENCED'
    );
  }
});
test('malformed fence objects hold without real DB impact', () => {
  blocked(
    reviewInertWriterFenceThreat({ fixture: null }),
    'WRITER_FENCE_PROTOCOL_REQUIRED'
  );
  for (const name of [
    'control',
    'writers',
    'privileged',
    'unknownWriters',
    'externalControls'
  ]) {
    const f = fence();
    f[name] = null;
    assert.doesNotThrow(() => reviewInertWriterFenceThreat({ fixture: f }));
    denyLive(reviewInertWriterFenceThreat({ fixture: f }));
  }
});
test('combined reviews cannot turn three synthetic passes into GO', () => {
  const out = reviewCombinedInertThreats(combined());
  good(out, 'NO_GO_INERT_COMBINED');
  assert.equal(out.fullSyntheticInvariantPass, true);
  assert.equal(out.realCutoverReady, false);
  assert.deepEqual(Object.keys(out.subsystems).sort(), [
    'cas',
    'fence',
    'owner'
  ]);
});
const combinedThreats = [
  [
    'owner field fails',
    (f) => {
      f.owner.event.author = 'not-owner';
    },
    'OWNER_PROVENANCE_INVALID'
  ],
  [
    'control field fails',
    (f) => {
      f.cas.proposal.expectedVersion = 3;
    },
    'CONTROL_CAS_INVALID'
  ],
  [
    'writer field fails',
    (f) => {
      f.fence.writers[0].blockedInFixture = false;
    },
    'DATA_PLANE_FENCE_INVALID'
  ],
  [
    'owner comment differs from CAS',
    (f) => {
      f.cas.request.commentId = 735002;
    },
    'OWNER_CONTROL_CLAIM_BINDING_DISJOINT'
  ],
  [
    'owner main differs from CAS',
    (f) => {
      f.cas.request.mainSha = 'c'.repeat(40);
    },
    'OWNER_CONTROL_CLAIM_BINDING_DISJOINT'
  ],
  [
    'owner HEAD differs from CAS',
    (f) => {
      f.cas.request.headSha = 'c'.repeat(40);
    },
    'OWNER_CONTROL_CLAIM_BINDING_DISJOINT'
  ],
  [
    'wrong fence epoch even with internally valid fence',
    (f) => {
      f.fence.control.epoch = 14;
      f.fence.control.priorEpoch = 13;
      for (const w of f.fence.writers) w.observedEpoch = 14;
    },
    'CONTROL_FENCE_EPOCH_DOMAIN_SPLIT'
  ],
  [
    'owner missing',
    (f) => {
      f.owner = null;
    },
    'OWNER_PROVENANCE_INVALID'
  ],
  [
    'cas missing',
    (f) => {
      f.cas = null;
    },
    'CONTROL_CAS_INVALID'
  ],
  [
    'fence missing',
    (f) => {
      f.fence = null;
    },
    'DATA_PLANE_FENCE_INVALID'
  ]
];
for (const [name, mutate, code] of combinedThreats)
  test('cross-domain threat: ' + name, () => {
    const f = combined();
    mutate(f);
    blocked(reviewCombinedInertThreats(f), code);
  });
test('null combined input returns HOLD rather than granting permission', () => {
  blocked(reviewCombinedInertThreats({}), 'OWNER_PROVENANCE_INVALID');
});
test('successful fixture never causes an actual spent tombstone or writer state change', () => {
  const f = combined(),
    before = JSON.stringify(f);
  reviewCombinedInertThreats(f);
  assert.equal(JSON.stringify(f), before);
  assert.equal(f.cas.observed.spentComments.length, 0);
  assert.ok(f.fence.externalControls.backupRestoreVerifiedLive === false);
  assert.equal(f.owner.request.scope, SNAPSHOT_PLAN_SCOPE);
});
