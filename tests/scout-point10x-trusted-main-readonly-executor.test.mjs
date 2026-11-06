import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import {
  CONTROL_ISSUE,
  LIVE_RUNTIME_ENABLED,
  PRODUCTION_REF,
  READONLY_BEGIN,
  READONLY_IDS,
  READONLY_OPERATION,
  READONLY_SCOPE,
  STAGING_REF,
  compilePinnedReadOnlyBatch,
  exerciseInertSingleSession,
  inspectFutureOwnerRequest,
  runTrustedMainReadOnly
} from '../scripts/scout-point10x-trusted-main-readonly-executor.mjs';

const hash = (s) => createHash('sha256').update(s).digest('hex');
const good = compilePinnedReadOnlyBatch();
const makeTrace = () => ({
  transport: 'DETERMINISTIC_IN_MEMORY_NO_DATABASE',
  connections: 1,
  sessions: 1,
  transactions: 1,
  isolation: 'REPEATABLE READ',
  access: 'READ ONLY',
  commands: [READONLY_BEGIN, ...READONLY_IDS, 'ROLLBACK', 'CLOSE'],
  rollbackAck: true,
  closeAck: true,
  results: READONLY_IDS.map((id, i) => ({
    id,
    resultDigest: hash('synthetic-row-' + i),
    rowCount: i,
    snapshotTag: 'synthetic-one'
  }))
});
const makeBatch = () => ({
  ...good,
  statements: good.statements.map((s) => ({ ...s }))
});
const shape = () => ({
  scope: READONLY_SCOPE,
  operation: READONLY_OPERATION,
  issue: CONTROL_ISSUE,
  mainSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  stagingRef: STAGING_REF,
  manifestDigest: good.manifestDigest,
  runCount: 1
});
const inspect = (claim) =>
  inspectFutureOwnerRequest({
    claim,
    mainSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    manifestDigest: good.manifestDigest
  });

test('source: byte-exact 8+3 files remain unchanged', () => {
  const files = [
    [
      '../docs/plans/READER-REWARD-POINT10X-STAGING-CATALOG-READONLY-20261105.sql',
      '740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11'
    ],
    [
      '../docs/plans/READER-REWARD-POINT10X-STAGING-PRIVILEGED-CATALOG-ADDENDUM-20261105.sql',
      '6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1'
    ]
  ];
  for (const [path, digest] of files) {
    const source = readFileSync(new URL(path, import.meta.url));
    assert.equal(hash(source), digest);
  }
});
test('compiler: pinned source 11 IDs and one BEGIN/ROLLBACK', () => {
  assert.equal(good.statements.length, 11);
  assert.deepEqual(
    good.statements.map((s) => s.id),
    READONLY_IDS
  );
  assert.equal(good.begin, READONLY_BEGIN);
  assert.equal(good.end, 'ROLLBACK');
  assert.equal(good.liveEnabled, false);
  assert.equal(good.scope, READONLY_SCOPE);
  assert.equal(good.stagingRef, STAGING_REF);
  assert.notEqual(good.stagingRef, PRODUCTION_REF);
  for (const s of good.statements) {
    assert.equal(hash(s.sql), s.sha256);
    assert.match(
      s.sql.replace(/^(?:--[^\r\n]*(?:\r?\n|$)\s*)+/gu, '').trim(),
      /^(?:SELECT|WITH)\s/iu
    );
    assert.equal((s.sql.match(/;/gu) || []).length, 1);
  }
});
test('compiler: statement list and result are frozen', () => {
  assert.ok(Object.isFrozen(good));
  assert.ok(Object.isFrozen(good.statements));
  assert.ok(good.statements.every(Object.isFrozen));
  assert.match(good.manifestDigest, /^[0-9a-f]{64}$/u);
});
test('safe default: runtime never connects/claims/uses arguments', async () => {
  assert.equal(LIVE_RUNTIME_ENABLED, false);
  await assert.rejects(
    () =>
      runTrustedMainReadOnly({
        preApproved: true,
        owner: 'OWNER',
        sql: 'COMMIT',
        stagingRef: PRODUCTION_REF
      }),
    /NO_LIVE_OWNER_CONTROL_ROLE_OR_AUDIT_ADAPTER/u
  );
});
test('offline kernel: complete fixture is still NO-GO and never actual proof', async () => {
  const r = await exerciseInertSingleSession({
    batch: good,
    transcript: makeTrace()
  });
  assert.equal(r.status, 'NO_GO_OFFLINE_KERNEL_VERIFIED');
  assert.equal(r.checkedSections, 11);
  assert.equal(r.actualDbConnected, false);
  assert.equal(r.ownerAuthenticated, false);
  assert.equal(r.controlSpentCommitted, false);
  assert.equal(r.realSnapshotProven, false);
  assert.equal(r.mayRunStaging, false);
  assert.equal(r.noAutomaticRetry, true);
  assert.equal(JSON.stringify(r).includes('synthetic-row-'), false);
});
test('future approval shape: complete shape is NOT authentication or permission', () => {
  assert.deepEqual(inspect(shape()), {
    status: 'NO_GO_OWNER_SHAPE_ONLY',
    ownerAuthenticated: false
  });
});
for (const [name, changed] of [
  [
    'missing scope',
    (x) => {
      delete x.scope;
    }
  ],
  [
    'extra trusted flag',
    (x) => {
      x.ownerAuthenticated = true;
    }
  ],
  [
    'wrong scope',
    (x) => {
      x.scope = 'reader-reward-beta-point-10x-staging';
    }
  ],
  [
    'wrong operation',
    (x) => {
      x.operation = 'atomic-persistent-staging-cutover';
    }
  ],
  [
    'wrong issue',
    (x) => {
      x.issue = 1837;
    }
  ],
  [
    'wrong staging ref',
    (x) => {
      x.stagingRef = PRODUCTION_REF;
    }
  ],
  [
    'old main',
    (x) => {
      x.mainSha = 'c'.repeat(40);
    }
  ],
  [
    'old PR head',
    (x) => {
      x.headSha = 'c'.repeat(40);
    }
  ],
  [
    'manifest mismatch',
    (x) => {
      x.manifestDigest = 'c'.repeat(64);
    }
  ],
  [
    'retry count',
    (x) => {
      x.runCount = 2;
    }
  ]
])
  test('approval shape HOLD: ' + name, () => {
    const c = shape();
    changed(c);
    assert.equal(inspect(c).status, 'HOLD_UNVERIFIED_OWNER_SCOPE');
  });
for (const [name, changed] of [
  ['missing batch', () => null],
  [
    'live enabled',
    (x) => {
      x.liveEnabled = true;
    }
  ],
  [
    'wrong scope',
    (x) => {
      x.scope = 'rollback-only';
    }
  ],
  [
    'wrong operation',
    (x) => {
      x.operation = 'read-catalog-bundle-only';
    }
  ],
  [
    'production project',
    (x) => {
      x.stagingRef = PRODUCTION_REF;
    }
  ],
  [
    'changed manifest',
    (x) => {
      x.manifestDigest = 'd'.repeat(64);
    }
  ],
  [
    'missing query',
    (x) => {
      x.statements.pop();
    }
  ],
  [
    'extra query',
    (x) => {
      x.statements.push({ ...x.statements[0] });
    }
  ],
  [
    'query order',
    (x) => {
      x.statements.reverse();
    }
  ],
  [
    'query digest',
    (x) => {
      x.statements[2].sha256 = '0'.repeat(64);
    }
  ],
  [
    'SQL injection',
    (x) => {
      x.statements[1].sql += ' COMMIT;';
    }
  ],
  [
    'wrong command begin',
    (x) => {
      x.begin = 'BEGIN';
    }
  ]
])
  test('batch fail-closed: ' + name, async () => {
    const b = changed.length === 0 ? changed() : makeBatch();
    if (b !== null) changed(b);
    await assert.rejects(
      () =>
        exerciseInertSingleSession({
          batch: b,
          transcript: makeTrace()
        }),
      /POINT10X_READONLY_HOLD/u
    );
  });
for (const [name, changed] of [
  ['missing transcript', () => null],
  [
    'real postgres transport',
    (x) => {
      x.transport = 'postgres';
    }
  ],
  [
    'two connections',
    (x) => {
      x.connections = 2;
    }
  ],
  [
    'split sessions',
    (x) => {
      x.sessions = 2;
    }
  ],
  [
    'split transaction',
    (x) => {
      x.transactions = 2;
    }
  ],
  [
    'read write',
    (x) => {
      x.access = 'READ WRITE';
    }
  ],
  [
    'wrong isolation',
    (x) => {
      x.isolation = 'READ COMMITTED';
    }
  ],
  [
    'no rollback',
    (x) => {
      x.rollbackAck = false;
    }
  ],
  [
    'unknown close ACK',
    (x) => {
      x.closeAck = null;
    }
  ],
  [
    'no rollback command',
    (x) => {
      x.commands.splice(12, 1);
    }
  ],
  [
    'extra COMMIT',
    (x) => {
      x.commands.splice(2, 0, 'COMMIT');
    }
  ],
  [
    'wrong order',
    (x) => {
      x.commands[3] = 'NL-GAP-03';
    }
  ],
  [
    'missing result',
    (x) => {
      x.results.pop();
    }
  ],
  [
    'different snapshot',
    (x) => {
      x.results[4].snapshotTag = 'synthetic-two';
    }
  ],
  [
    'raw rows leak',
    (x) => {
      x.results[1].rows = [{ user: 'real' }];
    }
  ],
  [
    'invalid result digest',
    (x) => {
      x.results[1].resultDigest = 'abc';
    }
  ],
  [
    'negative result count',
    (x) => {
      x.results[1].rowCount = -1;
    }
  ],
  [
    'SQL result not anonymous',
    (x) => {
      x.results[1].id = 'user-123';
    }
  ],
  [
    'fake snapshot id',
    (x) => {
      x.results[0].snapshotTag = 'real-pg-snapshot';
    }
  ],
  [
    'fake trusted attestation',
    (x) => {
      x.authenticated = true;
    }
  ]
])
  test('single-session HOLD: ' + name, async () => {
    const t = changed.length === 0 ? changed() : makeTrace();
    if (t !== null) changed(t);
    await assert.rejects(
      () =>
        exerciseInertSingleSession({
          batch: good,
          transcript: t
        }),
      /POINT10X_READONLY_HOLD/u
    );
  });

for (const fault of ['begin', 'select-5', 'rollback', 'close']) {
  test('real kernel ordering fault is held offline: ' + fault, async () => {
    await assert.rejects(
      () =>
        exerciseInertSingleSession({
          batch: good,
          transcript: makeTrace(),
          fault
        }),
      /POINT10X_READONLY_HOLD/u
    );
  });
}
test('unknown fault cannot unlock the inert transport', async () => {
  await assert.rejects(
    () =>
      exerciseInertSingleSession({
        batch: good,
        transcript: makeTrace(),
        fault: 'allow-live'
      }),
    /UNSUPPORTED_FAULT_INJECTION/u
  );
});
