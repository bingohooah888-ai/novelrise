import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import {
  CONFIG,
  SECTION_IDS,
  assembleRedactedAuditEvidence,
  executeTrustedReadOnly,
  inspectStagingReaderProbe,
  inspectTrustedMainEventShape,
  planIndependentControlCas,
  verifyOfflineAuditSignature
} from '../scripts/scout-point10x-offline-admission-contract.mjs';
import {
  createEphemeralAuditSimulator,
  createEphemeralControlSimulator
} from '../scripts/scout-point10x-offline-failure-simulator.mjs';

const sha256 = (x) => createHash('sha256').update(x).digest('hex');
const now = '2026-11-06T01:30:00Z';
const event = () => ({
  action: 'created',
  actorId: CONFIG.ownerId,
  actorLogin: CONFIG.ownerLogin,
  commentCreatedAt: now,
  commentUpdatedAt: now,
  commentId: 90001234,
  deliveryId: '11111111-2222-3333-4444-555555555555',
  eventName: 'issue_comment',
  issueNumber: CONFIG.issue,
  mainSha: 'a'.repeat(40),
  ownerScopeMarker: 'NOVELIGHT_POINT10X_READONLY_OWNER_V2',
  repository: CONFIG.repo,
  repositoryOwnerId: CONFIG.ownerId,
  runAttempt: 1,
  runner: 'github-actions',
  workflowRef: CONFIG.workflowRef,
  workflowSha: 'a'.repeat(40)
});
const cas = () => ({
  approvalDigest: 'b'.repeat(64),
  commentId: 90001234,
  expectedEpoch: 5,
  mainSha: 'a'.repeat(40),
  manifestDigest: 'c'.repeat(64),
  mutationDomain: CONFIG.controlMutationDomain,
  operation: CONFIG.operation,
  pr2766Head: 'd'.repeat(40),
  pr2767Head: 'e'.repeat(40),
  repo: CONFIG.repo,
  runCount: 1,
  scope: CONFIG.scope,
  stagingRef: CONFIG.stagingRef
});
const role = () => ({
  canConnect: true,
  canCreateSchema: false,
  canCreateTemp: false,
  canDml: false,
  canExecuteUnapproved: false,
  canReadCatalog: true,
  canSetRole: false,
  connectionRef: CONFIG.stagingRef,
  dbOwner: false,
  effectiveRole: CONFIG.proposedReaderRole,
  grantMembers: [],
  isStaging: true,
  rolBypassRls: false,
  rolCreateDb: false,
  rolCreateRole: false,
  rolInherit: false,
  rolReplication: false,
  rolSuper: false,
  serverFingerprint: 'f'.repeat(64),
  sessionUser: CONFIG.proposedReaderRole,
  stagingRef: CONFIG.stagingRef
});
const audit = () => ({
  approvalDigest: 'a'.repeat(64),
  closeAck: true,
  controlSpentDigest: 'b'.repeat(64),
  evidencePolicyDigest: 'c'.repeat(64),
  mainSha: 'a'.repeat(40),
  manifestDigest: 'd'.repeat(64),
  ownerProofDigest: 'e'.repeat(64),
  prHeadSha: 'b'.repeat(40),
  readRoleDigest: 'f'.repeat(64),
  rollbackAck: true,
  runId: 'synthetic_run_20261106',
  sections: SECTION_IDS.map((id, i) => ({
    id,
    rowCount: i,
    resultDigest: sha256('fake-result-' + i)
  })),
  snapshotDigest: '0'.repeat(64),
  sourceSqlDigests: [...CONFIG.sourceSqlDigests],
  stagingRef: CONFIG.stagingRef,
  transactionMode: 'ONE_CONNECTION_REPEATABLE_READ_READ_ONLY_ROLLBACK'
});
const denied = /POINT10X_(?:OFFLINE|SIM)_HOLD/u;

test('contracts are explicitly OFFLINE and preserve 8+3 manifest source pins', () => {
  assert.equal(SECTION_IDS.length, 11);
  assert.equal(SECTION_IDS[0], 'NL-CATALOG-01');
  assert.equal(SECTION_IDS[7], 'NL-CATALOG-08');
  assert.equal(SECTION_IDS[8], 'NL-GAP-01');
  assert.equal(SECTION_IDS[10], 'NL-GAP-03');
  assert.deepEqual(CONFIG.sourceSqlDigests, [
    '740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11',
    '6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1'
  ]);
  assert.ok(Object.isFrozen(CONFIG));
});
test('trusted-main event exact shape is NO-GO, not GitHub authentication', () => {
  const out = inspectTrustedMainEventShape(event(), 'a'.repeat(40));
  assert.equal(out.status, 'NO_GO_EVENT_SHAPE_ONLY');
  assert.equal(out.githubEventAuthenticated, false);
  assert.equal(out.ownerAuthenticated, false);
  assert.equal(out.oneUseApprovalConsumed, false);
  assert.equal(out.liveAuthorized, false);
  assert.equal(out.eventDigest.length, 64);
});
for (const [name, mutate] of [
  [
    'non-owner ID',
    (x) => {
      x.actorId = 42;
    }
  ],
  [
    'owner login spoof',
    (x) => {
      x.actorLogin = 'other';
    }
  ],
  [
    'wrong repository',
    (x) => {
      x.repository = 'attacker/novelrise';
    }
  ],
  [
    'wrong numeric repository owner',
    (x) => {
      x.repositoryOwnerId = 1;
    }
  ],
  [
    'wrong issue',
    (x) => {
      x.issueNumber = 12;
    }
  ],
  [
    'wrong event',
    (x) => {
      x.eventName = 'workflow_dispatch';
    }
  ],
  [
    'edited comment event',
    (x) => {
      x.action = 'edited';
    }
  ],
  [
    'incorrect runner',
    (x) => {
      x.runner = 'local-user';
    }
  ],
  [
    'run replay',
    (x) => {
      x.runAttempt = 2;
    }
  ],
  [
    'non-trusted workflow ref',
    (x) => {
      x.workflowRef = 'attacker/workflow@main';
    }
  ],
  [
    'workflow code SHA changed',
    (x) => {
      x.workflowSha = '9'.repeat(40);
    }
  ],
  [
    'main changed',
    (x) => {
      x.mainSha = '8'.repeat(40);
    }
  ],
  [
    'owner V1 scope replay',
    (x) => {
      x.ownerScopeMarker = 'NOVELIGHT_POINT10X_READONLY_OWNER_V1';
    }
  ],
  [
    'missing comment ID',
    (x) => {
      x.commentId = null;
    }
  ],
  [
    'bad delivery UUID',
    (x) => {
      x.deliveryId = 'forged';
    }
  ],
  [
    'comment edited',
    (x) => {
      x.commentUpdatedAt = '2026-11-06T01:31:00Z';
    }
  ],
  [
    'future/invalid date',
    (x) => {
      x.commentCreatedAt = 'invalid';
      x.commentUpdatedAt = 'invalid';
    }
  ],
  [
    'fake authorization flag',
    (x) => {
      x.ownerAuthenticated = true;
    }
  ],
  [
    'missing field',
    (x) => {
      delete x.workflowSha;
    }
  ],
  [
    'unknown secret field',
    (x) => {
      x.authorization = 'fake-secret';
    }
  ]
])
  test('trusted event HOLD: ' + name, () => {
    const input = event();
    mutate(input);
    assert.throws(
      () => inspectTrustedMainEventShape(input, 'a'.repeat(40)),
      denied
    );
  });
test('CONTROL contract accepts only one immutable scoped proposal, still NO-GO', () => {
  const p = planIndependentControlCas(cas());
  assert.equal(p.status, 'NO_GO_CONTROL_CAS_PLAN_ONLY');
  assert.equal(p.realSpentCommitted, false);
  assert.equal(p.realControlConnected, false);
  assert.equal(p.automaticRetryAllowed, false);
  assert.equal(p.liveAuthorized, false);
});
for (const [name, mutate] of [
  [
    'production ref',
    (x) => {
      x.stagingRef = CONFIG.productionRef;
    }
  ],
  [
    'wrong operation',
    (x) => {
      x.operation = 'persistent-staging-cutover';
    }
  ],
  [
    'wrong scope',
    (x) => {
      x.scope = 'all';
    }
  ],
  [
    'wrong repo',
    (x) => {
      x.repo = 'attacker/novelrise';
    }
  ],
  [
    'wrong mutation domain',
    (x) => {
      x.mutationDomain = 'staging-only';
    }
  ],
  [
    'second use',
    (x) => {
      x.runCount = 2;
    }
  ],
  [
    'invalid comment ID',
    (x) => {
      x.commentId = 0;
    }
  ],
  [
    'stale/missing epoch',
    (x) => {
      x.expectedEpoch = null;
    }
  ],
  [
    'negative epoch',
    (x) => {
      x.expectedEpoch = -1;
    }
  ],
  [
    'changed main',
    (x) => {
      x.mainSha = 'x'.repeat(40);
    }
  ],
  [
    'missing dependency SHA',
    (x) => {
      delete x.pr2766Head;
    }
  ],
  [
    'incorrect admission SHA',
    (x) => {
      x.pr2767Head = '';
    }
  ],
  [
    'fake manifest digest',
    (x) => {
      x.manifestDigest = 'invalid';
    }
  ],
  [
    'missing approval digest',
    (x) => {
      x.approvalDigest = '';
    }
  ],
  [
    'synthetic approval flag',
    (x) => {
      x.spent = true;
    }
  ]
])
  test('CONTROL proposal HOLD: ' + name, () => {
    const input = cas();
    mutate(input);
    assert.throws(() => planIndependentControlCas(input), denied);
  });
test('CONTROL in-memory once-only linearization never grants real spent state', async () => {
  const ledger = createEphemeralControlSimulator({ initialEpoch: 5 });
  const plan = planIndependentControlCas(cas());
  const [first, second] = await Promise.all([
    Promise.resolve().then(() => ledger.claim({ plan })),
    Promise.resolve().then(() => ledger.claim({ plan }))
  ]);
  assert.equal(first.status, 'NO_GO_SIM_CLAIM_CONFIRMED_ONLY');
  assert.equal(first.simulatedSpent, true);
  assert.equal(first.realSpent, false);
  assert.equal(second.status, 'NO_GO_SIM_REPLAY_SPENT');
  assert.equal(second.realSpent, false);
  const read = ledger.readback(plan.commentId);
  assert.equal(read.status, 'NO_GO_SIM_READBACK_NOT_AUTHORITATIVE');
  assert.equal(read.requiresIndependentControlPrimary, true);
  assert.equal(read.realSpent, false);
});
test('CONTROL lost ACK is terminal HOLD, replay blocked, no automatic retry', () => {
  const ledger = createEphemeralControlSimulator({ initialEpoch: 5 });
  const plan = planIndependentControlCas(cas());
  const outcome = ledger.claim({ plan, ack: 'unknown' });
  assert.equal(outcome.status, 'NO_GO_SIM_COMMIT_ACK_UNKNOWN_HOLD');
  assert.equal(outcome.noAutomaticRetry, true);
  assert.equal(ledger.claim({ plan }).status, 'NO_GO_SIM_REPLAY_SPENT');
  assert.equal(ledger.readback(plan.commentId).simulatedSpent, true);
});
test('CONTROL no commit and stale epoch remain NO-GO', () => {
  const ledger = createEphemeralControlSimulator({ initialEpoch: 5 });
  const plan = planIndependentControlCas(cas());
  assert.equal(
    ledger.claim({ plan, ack: 'fail-before-commit' }).simulatedSpent,
    false
  );
  const stale = cas();
  stale.expectedEpoch = 4;
  assert.equal(
    ledger.claim({ plan: planIndependentControlCas(stale) }).status,
    'NO_GO_SIM_EPOCH_STALE'
  );
  assert.equal(ledger.readback(plan.commentId).simulatedSpent, false);
});
for (const [name, input] of [
  ['bad initial epoch', { initialEpoch: -1 }],
  ['fractional epoch', { initialEpoch: 1.5 }]
])
  test('CONTROL constructor HOLD: ' + name, () =>
    assert.throws(() => createEphemeralControlSimulator(input), denied)
  );
test('CONTROL unauthorized fake plan and invalid ACK are rejected', () => {
  const ledger = createEphemeralControlSimulator({ initialEpoch: 5 });
  assert.throws(
    () =>
      ledger.claim({
        plan: {
          status: 'GO',
          commentId: 1,
          proposalDigest: 'a'.repeat(64),
          expectedEpoch: 5
        }
      }),
    denied
  );
  assert.throws(
    () =>
      ledger.claim({ plan: planIndependentControlCas(cas()), ack: 'retry' }),
    denied
  );
  assert.throws(() => ledger.readback(-1), denied);
});
test('least-privilege probe shape never grants actual database rights', () => {
  const out = inspectStagingReaderProbe(role());
  assert.equal(out.status, 'NO_GO_STAGING_ROLE_SHAPE_ONLY');
  assert.equal(out.actualDbConnected, false);
  assert.equal(out.actualPgAclAuthenticated, false);
  assert.equal(out.liveAuthorized, false);
});
for (const key of [
  'canCreateSchema',
  'canCreateTemp',
  'canDml',
  'canExecuteUnapproved',
  'canSetRole',
  'dbOwner',
  'rolBypassRls',
  'rolCreateDb',
  'rolCreateRole',
  'rolInherit',
  'rolReplication',
  'rolSuper'
])
  test('role rejects privilege: ' + key, () => {
    const input = role();
    input[key] = true;
    assert.throws(() => inspectStagingReaderProbe(input), denied);
  });
for (const [name, mutate] of [
  [
    'production endpoint',
    (x) => {
      x.stagingRef = CONFIG.productionRef;
    }
  ],
  [
    'endpoint drift',
    (x) => {
      x.connectionRef = 'different-staging';
    }
  ],
  [
    'fake staging flag',
    (x) => {
      x.isStaging = false;
    }
  ],
  [
    'wrong session role',
    (x) => {
      x.sessionUser = 'postgres';
    }
  ],
  [
    'role switch',
    (x) => {
      x.effectiveRole = 'service_role';
    }
  ],
  [
    'member escalation',
    (x) => {
      x.grantMembers = ['postgres'];
    }
  ],
  [
    'invalid fingerprint',
    (x) => {
      x.serverFingerprint = 'unknown';
    }
  ],
  [
    'cannot read catalogs',
    (x) => {
      x.canReadCatalog = false;
    }
  ],
  [
    'cannot connect',
    (x) => {
      x.canConnect = false;
    }
  ],
  [
    'extra unknown privilege',
    (x) => {
      x.hasBypass = true;
    }
  ],
  [
    'missing privilege',
    (x) => {
      delete x.rolSuper;
    }
  ]
])
  test('role probe HOLD: ' + name, () => {
    const input = role();
    mutate(input);
    assert.throws(() => inspectStagingReaderProbe(input), denied);
  });
test('audit only releases digest-only sections, no rows/PII', () => {
  const out = assembleRedactedAuditEvidence(audit());
  assert.equal(out.status, 'NO_GO_AUDIT_REDACTED_SHAPE_ONLY');
  assert.equal(out.independentStorageVerified, false);
  assert.equal(out.actualResultsVerified, false);
  assert.equal(out.payload.sections.length, 11);
  assert.equal(out.digest, sha256(out.canonicalBody));
  assert.equal(out.canonicalBody.includes('fake-result-'), false);
  assert.equal(out.liveAuthorized, false);
});
for (const [name, mutate] of [
  [
    'raw user rows',
    (x) => {
      x.sections[0].rows = [{ user: 'someone' }];
    }
  ],
  [
    'authorization header',
    (x) => {
      x.apiKey = 'fake';
    }
  ],
  [
    'missing section',
    (x) => {
      x.sections.pop();
    }
  ],
  [
    'wrong section order',
    (x) => {
      x.sections.reverse();
    }
  ],
  [
    'invalid section digest',
    (x) => {
      x.sections[0].resultDigest = 'raw';
    }
  ],
  [
    'negative row count',
    (x) => {
      x.sections[0].rowCount = -1;
    }
  ],
  [
    'too many rows',
    (x) => {
      x.sections[0].rowCount = 100001;
    }
  ],
  [
    'raw snapshot',
    (x) => {
      x.snapshotDigest = 'raw-snapshot';
    }
  ],
  [
    'missing spent evidence',
    (x) => {
      x.controlSpentDigest = '';
    }
  ],
  [
    'expired source SQL digest',
    (x) => {
      x.sourceSqlDigests[0] = '0'.repeat(64);
    }
  ],
  [
    'read/write mode',
    (x) => {
      x.transactionMode = 'READ WRITE';
    }
  ],
  [
    'rollback not acknowledged',
    (x) => {
      x.rollbackAck = false;
    }
  ],
  [
    'close not acknowledged',
    (x) => {
      x.closeAck = null;
    }
  ],
  [
    'production',
    (x) => {
      x.stagingRef = CONFIG.productionRef;
    }
  ],
  [
    'unknown body key',
    (x) => {
      x.rawPayload = {};
    }
  ],
  [
    'invalid run ID',
    (x) => {
      x.runId = 'test';
    }
  ]
])
  test('redacted audit HOLD: ' + name, () => {
    const input = audit();
    mutate(input);
    assert.throws(() => assembleRedactedAuditEvidence(input), denied);
  });
test('ephemeral audit append/readback is NOT WORM or retention evidence', () => {
  const env = assembleRedactedAuditEvidence(audit());
  const store = createEphemeralAuditSimulator();
  const p = {
    runId: audit().runId,
    digestSha256: env.digest,
    canonicalBody: env.canonicalBody,
    now,
    expiresAt: '2026-11-06T02:00:00Z'
  };
  assert.equal(store.append(p).immutableExternalStorage, false);
  const a = store.readback({ runId: p.runId, now });
  assert.equal(a.status, 'NO_GO_SIM_AUDIT_READBACK_IN_MEMORY');
  assert.equal(a.retentionVerified, false);
  assert.equal(a.payloadReleased, false);
  assert.throws(() => store.append(p), denied);
  assert.throws(
    () => store.readback({ runId: p.runId, now: p.expiresAt }),
    denied
  );
});
test('ephemeral audit missing, tampered, expired evidence is held', () => {
  const store = createEphemeralAuditSimulator();
  const env = assembleRedactedAuditEvidence(audit());
  assert.throws(
    () => store.readback({ runId: 'not_written_123', now }),
    denied
  );
  assert.throws(
    () =>
      store.append({
        runId: audit().runId,
        digestSha256: env.digest,
        canonicalBody: env.canonicalBody + 'TAMPER',
        now,
        expiresAt: '2026-11-06T02:00:00Z'
      }),
    denied
  );
  assert.throws(
    () =>
      store.append({
        runId: audit().runId,
        digestSha256: env.digest,
        canonicalBody: env.canonicalBody,
        now,
        expiresAt: now
      }),
    denied
  );
});
test('Ed25519 signature mathematical check never claims independent custody', () => {
  const keys = generateKeyPairSync('ed25519');
  const env = assembleRedactedAuditEvidence(audit());
  const key = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const pin = sha256(keys.publicKey.export({ type: 'spki', format: 'der' }));
  const signatureBase64 = sign(
    null,
    Buffer.from(env.canonicalBody),
    keys.privateKey
  ).toString('base64');
  const p = {
    canonicalBody: env.canonicalBody,
    digest: env.digest,
    signatureBase64,
    publicKeyPem: key,
    pinnedSpkiSha256: pin
  };
  const out = verifyOfflineAuditSignature(p);
  assert.equal(out.status, 'NO_GO_AUDIT_SIGNATURE_MATH_ONLY');
  assert.equal(out.immutableStorageVerified, false);
  assert.equal(out.independentSignerVerified, false);
  assert.throws(
    () =>
      verifyOfflineAuditSignature({
        ...p,
        pinnedSpkiSha256: 'f'.repeat(64)
      }),
    denied
  );
  assert.throws(
    () =>
      verifyOfflineAuditSignature({
        ...p,
        canonicalBody: env.canonicalBody + 'tamper'
      }),
    denied
  );
  assert.throws(
    () =>
      verifyOfflineAuditSignature({
        ...p,
        signatureBase64: sign(
          null,
          Buffer.from('other'),
          keys.privateKey
        ).toString('base64')
      }),
    denied
  );
});
test('real executor is ALWAYS HOLD, even with synthetic owner and grant flags', async () => {
  await assert.rejects(
    () =>
      executeTrustedReadOnly({
        ownerAuthenticated: true,
        controlSpent: true,
        token: 'fake',
        stagingRole: CONFIG.proposedReaderRole
      }),
    denied
  );
});
test('module sources do not import DB/network adapters or create workflows', () => {
  for (const file of [
    '../scripts/scout-point10x-offline-admission-contract.mjs',
    '../scripts/scout-point10x-offline-failure-simulator.mjs'
  ]) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(
      text,
      /from ['"](?:pg|postgres|@supabase\/supabase-js|node:https|node:http)['"]/u
    );
    assert.doesNotMatch(text, /\bfetch\s*\(/u);
    assert.doesNotMatch(text, /\bprocess\.env\b/u);
  }
});
