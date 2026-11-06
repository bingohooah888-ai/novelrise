import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import {
  collectGitHubOwnerEvidenceReadOnly,
  GITHUB_OWNER_ID,
  GITHUB_OWNER_LOGIN,
  GITHUB_REPO,
  ISSUE_NUMBER,
  OWNER_FIELDS,
  OWNER_MARKER,
  OPERATION,
  PRODUCTION_REF,
  SCOPE,
  SQL_SOURCE_SHA256,
  STAGING_REF,
  inspectFreshGitHubOwnerEvidence,
  parseExactOwnerScope
} from '../scripts/scout-point10x-owner-readonly-evidence.mjs';
import { inspectMergedPrOnFreshMain } from '../scripts/scout-point10x-merged-main-attestation.mjs';
import {
  AUDIT_SECTION_IDS,
  EXPECTED_READER_ROLE,
  buildSanitizedAuditEnvelope,
  inspectProposedReadOnlyRole,
  verifyIndependentAuditReceipt
} from '../scripts/scout-point10x-role-audit-boundary.mjs';

const hash = (x) => createHash('sha256').update(x).digest('hex');
const now = '2026-11-06T01:03:00Z';
const created = '2026-11-06T01:00:00Z';
const COMMENT_ID = 888123;
const sortedJson = (x) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(x)
        .sort()
        .map((key) => [key, x[key]])
    )
  );
const approval = () => ({
  repo: GITHUB_REPO,
  issueNumber: ISSUE_NUMBER,
  ownerId: GITHUB_OWNER_ID,
  scope: SCOPE,
  operation: OPERATION,
  stagingRef: STAGING_REF,
  mainSha: 'a'.repeat(40),
  headSha2762: 'b'.repeat(40),
  headSha2766: 'c'.repeat(40),
  headSha2767: '8'.repeat(40),
  mergeSha2766: '6'.repeat(40),
  mergeSha2767: '7'.repeat(40),
  manifestDigest: 'd'.repeat(64),
  executorDigest: 'e'.repeat(64),
  evidencePolicyDigest: 'f'.repeat(64),
  expiresAt: '2026-11-06T01:08:00Z',
  runCount: 1,
  sqlSourceSha256: SQL_SOURCE_SHA256
});
const body = (v) => OWNER_MARKER + '\n' + sortedJson(v);
const mergedFixture = (number, headSha, mergeSha) => ({
  number,
  state: 'closed',
  draft: false,
  merged: true,
  merged_at: '2026-11-06T00:40:00Z',
  merged_by: { id: GITHUB_OWNER_ID, login: GITHUB_OWNER_LOGIN },
  merge_commit_sha: mergeSha,
  head: { sha: headSha, repo: { full_name: GITHUB_REPO } },
  base: { ref: 'main', repo: { full_name: GITHUB_REPO } }
});
const ancestryFixture = (mergeSha, mainSha) => ({
  status: 'ahead',
  ahead_by: 2,
  behind_by: 0,
  base_commit: { sha: mergeSha },
  merge_base_commit: { sha: mergeSha },
  head_commit: { sha: mainSha }
});
const evidence = () => {
  const a = approval();
  return {
    repo: {
      full_name: GITHUB_REPO,
      owner: {
        id: GITHUB_OWNER_ID,
        login: GITHUB_OWNER_LOGIN,
        type: 'User'
      },
      default_branch: 'main'
    },
    issue: {
      number: ISSUE_NUMBER,
      state: 'open',
      comments: 3,
      repository_url: 'https://api.github.com/repos/' + GITHUB_REPO
    },
    comment: {
      id: COMMENT_ID,
      user: { id: GITHUB_OWNER_ID, login: GITHUB_OWNER_LOGIN, type: 'User' },
      author_association: 'OWNER',
      issue_url:
        'https://api.github.com/repos/' +
        GITHUB_REPO +
        '/issues/' +
        ISSUE_NUMBER,
      created_at: created,
      updated_at: created,
      body: body(a)
    },
    allComments: [{ id: 123 }, { id: 124 }, { id: COMMENT_ID }],
    trigger: {
      eventName: 'issue_comment',
      action: 'created',
      commentId: COMMENT_ID,
      issueNumber: ISSUE_NUMBER,
      actorId: GITHUB_OWNER_ID,
      actorLogin: GITHUB_OWNER_LOGIN,
      repository: GITHUB_REPO,
      rerun: false
    },
    mainRef: { ref: 'refs/heads/main', object: { sha: a.mainSha } },
    mainRefAfter: { ref: 'refs/heads/main', object: { sha: a.mainSha } },
    pr2762: {
      number: 2762,
      state: 'open',
      draft: true,
      head: { sha: a.headSha2762 }
    },
    pr2766: mergedFixture(2766, a.headSha2766, a.mergeSha2766),
    pr2767: mergedFixture(2767, a.headSha2767, a.mergeSha2767),
    compare2766: ancestryFixture(a.mergeSha2766, a.mainSha),
    compare2767: ancestryFixture(a.mergeSha2767, a.mainSha),
    now
  };
};

test('owner canonical approval contains exactly reviewed tuple keys', () => {
  assert.deepEqual(Object.keys(approval()).sort(), [...OWNER_FIELDS]);
  assert.deepEqual(parseExactOwnerScope(body(approval())), approval());
});
test('OWNER evidence accepts only as NO-GO non-authorizing shape', () => {
  const result = inspectFreshGitHubOwnerEvidence(evidence());
  assert.equal(result.status, 'NO_GO_GITHUB_EVIDENCE_SHAPE_ONLY');
  assert.equal(result.ownerIdentityMatches, true);
  assert.equal(result.ownerAuthenticatedForExecution, false);
  assert.equal(result.controlSpentConsumed, false);
  assert.equal(result.mayConnectStaging, false);
  assert.equal(result.approvalDigest, hash(body(approval())));
});
test('duplicate JSON keys and noncanonical owner bodies fail closed', () => {
  const goodBody = body(approval());
  assert.throws(
    () =>
      parseExactOwnerScope(
        goodBody.replace('"runCount":1', '"runCount":2,"runCount":1')
      ),
    /POINT10X_OWNER_HOLD/u
  );
  assert.throws(
    () =>
      parseExactOwnerScope(
        OWNER_MARKER + '\n' + JSON.stringify(approval(), null, 2)
      ),
    /POINT10X_OWNER_HOLD/u
  );
  assert.throws(
    () => parseExactOwnerScope('OWNER APPROVED'),
    /POINT10X_OWNER_HOLD/u
  );
});
for (const [name, mutate] of [
  [
    'foreign repo',
    (v) => {
      v.repo.owner.id = 16;
    }
  ],
  [
    'renamed owner',
    (v) => {
      v.repo.owner.login = 'attacker';
    }
  ],
  [
    'issue closed',
    (v) => {
      v.issue.state = 'closed';
    }
  ],
  [
    'fake issue',
    (v) => {
      v.issue.number = 29;
    }
  ],
  [
    'missing history page',
    (v) => {
      v.allComments.pop();
    }
  ],
  [
    'unreliable issue count',
    (v) => {
      v.issue.comments = 2;
    }
  ],
  [
    'unordered pagination',
    (v) => {
      v.allComments.reverse();
    }
  ],
  [
    'non-owner comment',
    (v) => {
      v.comment.user.id = 9;
    }
  ],
  [
    'non-owner association',
    (v) => {
      v.comment.author_association = 'COLLABORATOR';
    }
  ],
  [
    'edited comment',
    (v) => {
      v.comment.updated_at = '2026-11-06T01:01:00Z';
    }
  ],
  [
    'deleted comment',
    (v) => {
      v.comment.deleted_at = created;
    }
  ],
  [
    'comment wrong issue',
    (v) => {
      v.comment.issue_url += '/other';
    }
  ],
  [
    'deleted from inventory',
    (v) => {
      v.allComments.splice(2, 1);
    }
  ],
  [
    'duplicated in pagination',
    (v) => {
      v.allComments.push({ id: 888123 });
    }
  ],
  [
    'not issue comment event',
    (v) => {
      v.trigger.eventName = 'workflow_dispatch';
    }
  ],
  [
    'trigger actor forgery',
    (v) => {
      v.trigger.actorId = 9;
    }
  ],
  [
    'rerun',
    (v) => {
      v.trigger.rerun = true;
    }
  ],
  [
    'stale main SHA',
    (v) => {
      v.mainRef.object.sha = '9'.repeat(40);
    }
  ],
  [
    'stale PR2762',
    (v) => {
      v.pr2762.head.sha = '9'.repeat(40);
    }
  ],
  [
    'stale PR2766',
    (v) => {
      v.pr2766.head.sha = '9'.repeat(40);
    }
  ],
  [
    'pre-merge draft with prospective merge SHA',
    (v) => {
      v.pr2766.merged = false;
      v.pr2766.state = 'open';
      v.pr2766.draft = true;
    }
  ],
  [
    'expired approval',
    (v) => {
      v.now = '2026-11-06T01:09:00Z';
    }
  ],
  [
    'future forged time',
    (v) => {
      v.now = '2026-11-06T00:59:00Z';
    }
  ],
  [
    'future expiry too long',
    (v) => {
      const x = approval();
      x.expiresAt = '2026-11-06T05:00:00Z';
      v.comment.body = body(x);
    }
  ],
  [
    'wrong scope',
    (v) => {
      const x = approval();
      x.scope = 'persistent-staging-cutover';
      v.comment.body = body(x);
    }
  ],
  [
    'production ref',
    (v) => {
      const x = approval();
      x.stagingRef = PRODUCTION_REF;
      v.comment.body = body(x);
    }
  ],
  [
    'replay run count',
    (v) => {
      const x = approval();
      x.runCount = 2;
      v.comment.body = body(x);
    }
  ],
  [
    'tampered source digest',
    (v) => {
      const x = approval();
      x.sqlSourceSha256 = ['f'.repeat(64), ...SQL_SOURCE_SHA256.slice(1)];
      v.comment.body = body(x);
    }
  ],
  [
    'missing manifest',
    (v) => {
      const x = approval();
      delete x.manifestDigest;
      v.comment.body = body(x);
    }
  ],
  [
    'extra trusted field',
    (v) => {
      const x = approval();
      x.ownerAuthenticated = true;
      v.comment.body = body(x);
    }
  ]
])
  test('OWNER fail closed: ' + name, () => {
    const v = evidence();
    mutate(v);
    assert.throws(
      () => inspectFreshGitHubOwnerEvidence(v),
      /POINT10X_(?:OWNER|MERGE)_HOLD/u
    );
  });
test('GitHub read-only API entry rejects missing credentials before GET', async () => {
  await assert.rejects(
    () =>
      collectGitHubOwnerEvidenceReadOnly({
        token: '',
        commentId: 123
      }),
    /POINT10X_OWNER_HOLD:FETCH_INPUT/u
  );
  await assert.rejects(
    () =>
      collectGitHubOwnerEvidenceReadOnly({
        token: 'not-a-real-token',
        commentId: -1
      }),
    /POINT10X_OWNER_HOLD/u
  );
});
const validRole = () => ({
  role: EXPECTED_READER_ROLE,
  stagingRef: STAGING_REF,
  connectionRef: STAGING_REF,
  isPrimaryStaging: true,
  rolsuper: false,
  rolbypassrls: false,
  rolcreaterole: false,
  rolcreatedb: false,
  rolreplication: false,
  rolinherit: false,
  rolcanlogin: true,
  isDbOwner: false,
  isServiceRole: false,
  pgWriteAllData: false,
  canSetRole: false,
  canCreateSchema: false,
  canCreateTemp: false,
  canInsert: false,
  canUpdate: false,
  canDelete: false,
  canTruncate: false,
  canTrigger: false,
  canExecuteUnapprovedFunction: false,
  canReadRequiredCatalogs: true,
  memberships: []
});
test('role: complete probe shape still NO-GO without trusted PG attestation', () => {
  const v = inspectProposedReadOnlyRole(validRole());
  assert.equal(v.status, 'NO_GO_ROLE_PROBE_SHAPE_ONLY');
  assert.equal(v.mayOpenConnection, false);
  assert.equal(v.requireTrustedIndependentAttestation, true);
});
for (const key of [
  'rolsuper',
  'rolbypassrls',
  'rolcreaterole',
  'rolcreatedb',
  'rolreplication',
  'rolinherit',
  'isDbOwner',
  'isServiceRole',
  'pgWriteAllData',
  'canSetRole',
  'canCreateSchema',
  'canCreateTemp',
  'canInsert',
  'canUpdate',
  'canDelete',
  'canTruncate',
  'canTrigger',
  'canExecuteUnapprovedFunction'
])
  test('role rejects effective privilege: ' + key, () => {
    const v = validRole();
    v[key] = true;
    assert.throws(() => inspectProposedReadOnlyRole(v), /POINT10X_AUDIT_HOLD/u);
  });
for (const [name, mutate] of [
  [
    'production',
    (v) => {
      v.stagingRef = PRODUCTION_REF;
    }
  ],
  [
    'endpoint drift',
    (v) => {
      v.connectionRef = 'unknown-endpoint';
    }
  ],
  [
    'not independent staging',
    (v) => {
      v.isPrimaryStaging = false;
    }
  ],
  [
    'service login',
    (v) => {
      v.role = 'service_role';
    }
  ],
  [
    'missing catalogs',
    (v) => {
      v.canReadRequiredCatalogs = false;
    }
  ],
  [
    'membership',
    (v) => {
      v.memberships.push('postgres');
    }
  ],
  [
    'unknown field',
    (v) => {
      v.superuserMayBeTrue = false;
    }
  ],
  [
    'missing field',
    (v) => {
      delete v.canDelete;
    }
  ]
])
  test('role rejects unsafe state: ' + name, () => {
    const v = validRole();
    mutate(v);
    assert.throws(() => inspectProposedReadOnlyRole(v), /POINT10X_AUDIT_HOLD/u);
  });

const goodAudit = () => ({
  runId: 'offline_review_20261106_01',
  scope: SCOPE,
  stagingRef: STAGING_REF,
  mainSha: 'a'.repeat(40),
  prHeadSha: 'b'.repeat(40),
  transactionMode: 'ONE_CONNECTION_REPEATABLE_READ_READ_ONLY_ROLLBACK',
  rollbackAck: true,
  closeAck: true,
  snapshotDigest: 'a'.repeat(64),
  githubOwnerProofDigest: 'b'.repeat(64),
  controlSpentProofDigest: 'c'.repeat(64),
  executorDigest: 'd'.repeat(64),
  manifestDigest: 'e'.repeat(64),
  evidencePolicyDigest: 'f'.repeat(64),
  readRoleProofDigest: '0'.repeat(64),
  sourceSqlDigests: [...SQL_SOURCE_SHA256],
  sectionEvidence: AUDIT_SECTION_IDS.map((id, i) => ({
    id,
    rowCount: i,
    resultDigest: hash('synthetic-' + i)
  }))
});
test('auditor: digest-only closed envelope has no raw records and NO-GO status', () => {
  const result = buildSanitizedAuditEnvelope(goodAudit());
  assert.equal(result.status, 'NO_GO_SANITIZED_UNTRUSTED_ENVELOPE');
  assert.equal(result.payload.sectionEvidence.length, 11);
  assert.ok(Object.isFrozen(result.payload.sectionEvidence));
  assert.equal(result.digest, hash(result.canonicalBody));
  assert.equal(result.canonicalBody.includes('synthetic-1'), false);
});
for (const [name, mutate] of [
  [
    'raw rows',
    (v) => {
      v.sectionEvidence[0].rows = [{ email: 'x@example.com' }];
    }
  ],
  [
    'extra key',
    (v) => {
      v.accessToken = 'fake';
    }
  ],
  [
    'missing section',
    (v) => {
      v.sectionEvidence.pop();
    }
  ],
  [
    'wrong order',
    (v) => {
      v.sectionEvidence.reverse();
    }
  ],
  [
    'raw snapshot',
    (v) => {
      v.snapshotDigest = 'actual-row-data';
    }
  ],
  [
    'missing spent proof',
    (v) => {
      v.controlSpentProofDigest = '';
    }
  ],
  [
    'unknown role',
    (v) => {
      v.readRoleProofDigest = null;
    }
  ],
  [
    'wrong source SQL hash',
    (v) => {
      v.sourceSqlDigests[0] = '1'.repeat(64);
    }
  ],
  [
    'read write tx',
    (v) => {
      v.transactionMode = 'READ_WRITE';
    }
  ],
  [
    'rollback ack unknown',
    (v) => {
      v.rollbackAck = null;
    }
  ],
  [
    'close ack unknown',
    (v) => {
      v.closeAck = null;
    }
  ],
  [
    'negative rowcount',
    (v) => {
      v.sectionEvidence[0].rowCount = -1;
    }
  ],
  [
    'huge rowcount',
    (v) => {
      v.sectionEvidence[0].rowCount = 100001;
    }
  ],
  [
    'not digest',
    (v) => {
      v.sectionEvidence[0].resultDigest = 'secret';
    }
  ],
  [
    'production project',
    (v) => {
      v.stagingRef = PRODUCTION_REF;
    }
  ]
])
  test('audit denies: ' + name, () => {
    const v = goodAudit();
    mutate(v);
    assert.throws(() => buildSanitizedAuditEnvelope(v), /POINT10X_AUDIT_HOLD/u);
  });
test('ed25519 audit signature mathematical proof never unlocks Staging', () => {
  const keyPair = generateKeyPairSync('ed25519');
  const pub = keyPair.publicKey.export({ type: 'spki', format: 'pem' });
  const pin = hash(keyPair.publicKey.export({ type: 'spki', format: 'der' }));
  const envelope = buildSanitizedAuditEnvelope(goodAudit());
  const signatureBase64 = sign(
    null,
    Buffer.from(envelope.canonicalBody),
    keyPair.privateKey
  ).toString('base64');
  const result = verifyIndependentAuditReceipt({
    envelope,
    signatureBase64,
    publicKeyPem: pub,
    pinnedSpkiSha256: pin
  });
  assert.equal(result.status, 'NO_GO_SIGNATURE_VERIFIED_ONLY');
  assert.equal(result.independentStorageVerified, false);
  assert.equal(result.readOnlyStagingApproved, false);
  assert.throws(
    () =>
      verifyIndependentAuditReceipt({
        envelope,
        signatureBase64,
        publicKeyPem: pub,
        pinnedSpkiSha256: '1'.repeat(64)
      }),
    /POINT10X_AUDIT_HOLD/u
  );
  assert.throws(
    () =>
      verifyIndependentAuditReceipt({
        envelope,
        signatureBase64,
        publicKeyPem: pub,
        pinnedSpkiSha256: pin,
        // the original signature may not be repurposed for a new body/digest
        ...{
          envelope: {
            ...envelope,
            canonicalBody: envelope.canonicalBody.replace('runId', 'runIdx')
          }
        }
      }),
    /POINT10X_AUDIT_HOLD/u
  );
  const tampered = sign(
    null,
    Buffer.from('different'),
    keyPair.privateKey
  ).toString('base64');
  assert.throws(
    () =>
      verifyIndependentAuditReceipt({
        envelope,
        signatureBase64: tampered,
        publicKeyPem: pub,
        pinnedSpkiSha256: pin
      }),
    /POINT10X_AUDIT_HOLD/u
  );
});
test('CONTROL SQL candidate is independent, tombstone-unique, no installed grants', () => {
  const sql = readFileSync(
    new URL(
      '../docs/plans/POINT10X-INDEPENDENT-CONTROL-CAS-CANDIDATE-20261106.sql',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(sql, /DO NOT RUN IN THIS TURN/u);
  assert.match(sql, /SECURITY DEFINER/u);
  assert.equal((sql.match(/^BEGIN;$/gmu) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;$/gmu) || []).length, 1);
  assert.ok(
    sql.indexOf('CREATE FUNCTION') < sql.indexOf('REVOKE ALL ON FUNCTION')
  );
  assert.ok(sql.indexOf('REVOKE ALL ON FUNCTION') < sql.lastIndexOf('COMMIT;'));
  assert.doesNotMatch(sql, /CREATE OR REPLACE|IF NOT EXISTS/iu);
  assert.match(sql, /FOR UPDATE;/u);
  assert.match(sql, /PRIMARY KEY \(repo, issue_number, comment_id\)/u);
  assert.match(sql, /ON CONFLICT DO NOTHING/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION/u);
  assert.match(sql, /UPDATE point10x_control.domain_epochs/u);
  assert.doesNotMatch(sql, /^\s*GRANT\s/imu);
  assert.doesNotMatch(sql, /^\s*(?:DELETE|TRUNCATE|DROP)\s/imu);
  assert.doesNotMatch(sql, /fiepaguycecrredwrcwx/u);
});

test('real GitHub collector sends only fixed GETs in an OFFLINE fetch stub', async () => {
  const fixture = evidence();
  const base = 'https://api.github.com/repos/' + GITHUB_REPO;
  const routes = new Map([
    ['', fixture.repo],
    ['/issues/294', fixture.issue],
    ['/issues/comments/888123', fixture.comment],
    ['/git/ref/heads/main', fixture.mainRef],
    ['/pulls/2762', fixture.pr2762],
    ['/pulls/2766', fixture.pr2766],
    ['/pulls/2767', fixture.pr2767],
    [
      '/compare/' +
        approval().mergeSha2766 +
        '...' +
        approval().mainSha +
        '?per_page=1&page=1',
      fixture.compare2766
    ],
    [
      '/compare/' +
        approval().mergeSha2767 +
        '...' +
        approval().mainSha +
        '?per_page=1&page=1',
      fixture.compare2767
    ],
    ['/issues/294/comments?per_page=100&page=1', fixture.allComments]
  ]);
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    assert.ok(url.startsWith(base));
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Accept, 'application/vnd.github+json');
    assert.ok(!url.includes('token'));
    seen.push(url.slice(base.length));
    return {
      ok: true,
      async json() {
        if (!routes.has(url.slice(base.length)))
          throw new Error('unlisted URL');
        return routes.get(url.slice(base.length));
      }
    };
  };
  try {
    const payload = await collectGitHubOwnerEvidenceReadOnly({
      token: 'synthetic-never-real-credential',
      commentId: 888123
    });
    assert.equal(seen.length, 11);
    assert.equal(seen.filter((x) => x === '/git/ref/heads/main').length, 2);
    assert.ok(seen.every((x) => !x.includes('POST') && !x.includes('DELETE')));
    assert.deepEqual(
      inspectFreshGitHubOwnerEvidence({
        ...payload,
        trigger: fixture.trigger,
        now
      }).status,
      'NO_GO_GITHUB_EVIDENCE_SHAPE_ONLY'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('merged dependency: both real GitHub merge proofs remain NO-GO by design', () => {
  const v = evidence();
  for (const number of [2766, 2767]) {
    const proof = inspectMergedPrOnFreshMain({
      pr: v['pr' + number],
      comparison: v['compare' + number],
      number,
      expectedHead: approval()['headSha' + number],
      expectedMerge: approval()['mergeSha' + number],
      mainSha: approval().mainSha,
      approvalCreatedAt: created
    });
    assert.equal(proof.status, 'NO_GO_MERGED_MAIN_ANCESTRY_SHAPE_ONLY');
    assert.equal(proof.presentOnMain, true);
    assert.equal(proof.trustedGithubFetchVerified, false);
    assert.equal(proof.ownerAuthenticatedForExecution, false);
    assert.equal(proof.controlSpentConsumed, false);
    assert.equal(proof.mayConnectStaging, false);
  }
});
test('merged dependency: identical compare is valid only for exact main SHA', () => {
  const v = evidence();
  v.compare2766.status = 'identical';
  v.compare2766.ahead_by = 0;
  assert.equal(inspectFreshGitHubOwnerEvidence(v).mayConnectStaging, false);
});
for (const [name, alter] of [
  [
    'unmerged despite prefilled merge SHA',
    (v) => {
      v.pr2766.merged = false;
      v.pr2766.state = 'open';
      v.pr2766.draft = true;
    }
  ],
  [
    'open PR marked merged',
    (v) => {
      v.pr2766.state = 'open';
    }
  ],
  [
    'draft flag post-merge',
    (v) => {
      v.pr2766.draft = true;
    }
  ],
  [
    'merge commit fabricated',
    (v) => {
      v.pr2766.merge_commit_sha = '9'.repeat(40);
    }
  ],
  [
    'PR head rewritten',
    (v) => {
      v.pr2766.head.sha = '9'.repeat(40);
    }
  ],
  [
    'PR head repo spoofed',
    (v) => {
      v.pr2766.head.repo.full_name = 'other/novelrise';
    }
  ],
  [
    'PR base repo spoofed',
    (v) => {
      v.pr2766.base.repo.full_name = 'other/novelrise';
    }
  ],
  [
    'PR base branch wrong',
    (v) => {
      v.pr2766.base.ref = 'staging';
    }
  ],
  [
    'missing merged at',
    (v) => {
      v.pr2766.merged_at = null;
    }
  ],
  [
    'merge after owner comment',
    (v) => {
      v.pr2766.merged_at = '2026-11-06T01:01:00Z';
    }
  ],
  [
    'missing GitHub merger',
    (v) => {
      v.pr2766.merged_by = null;
    }
  ],
  [
    'invalid GitHub merger',
    (v) => {
      v.pr2766.merged_by.id = 0;
    }
  ],
  [
    'wrong dependency PR number',
    (v) => {
      v.pr2766.number = 123;
    }
  ],
  [
    'lookalike main compare',
    (v) => {
      v.compare2766.head_commit.sha = '9'.repeat(40);
    }
  ],
  [
    'wrong compare base',
    (v) => {
      v.compare2766.base_commit.sha = '9'.repeat(40);
    }
  ],
  [
    'wrong merge base',
    (v) => {
      v.compare2766.merge_base_commit.sha = '9'.repeat(40);
    }
  ],
  [
    'compare behind',
    (v) => {
      v.compare2766.status = 'behind';
    }
  ],
  [
    'compare diverged',
    (v) => {
      v.compare2766.status = 'diverged';
    }
  ],
  [
    'compare ahead-by zero',
    (v) => {
      v.compare2766.ahead_by = 0;
    }
  ],
  [
    'compare behind-by nonzero',
    (v) => {
      v.compare2766.behind_by = 2;
    }
  ],
  [
    'identical with nonzero ahead-by',
    (v) => {
      v.compare2766.status = 'identical';
    }
  ],
  [
    'missing comparison',
    (v) => {
      v.compare2766 = null;
    }
  ],
  [
    'main drift between reads',
    (v) => {
      v.mainRefAfter.object.sha = '9'.repeat(40);
    }
  ],
  [
    'main wrong branch',
    (v) => {
      v.mainRef.ref = 'refs/heads/old-main';
    }
  ],
  [
    'self PR not merged',
    (v) => {
      v.pr2767.merged = false;
    }
  ],
  [
    'self PR merge SHA different',
    (v) => {
      v.pr2767.merge_commit_sha = '9'.repeat(40);
    }
  ],
  [
    'self PR not on main',
    (v) => {
      v.compare2767.status = 'behind';
    }
  ],
  [
    'self PR head stale',
    (v) => {
      v.pr2767.head.sha = '9'.repeat(40);
    }
  ],
  [
    'self PR merge after approval',
    (v) => {
      v.pr2767.merged_at = '2026-11-06T01:02:00Z';
    }
  ],
  [
    'approval dependency SHA swapped',
    (v) => {
      const a = approval();
      a.mergeSha2766 = '9'.repeat(40);
      v.comment.body = body(a);
    }
  ],
  [
    'approval own SHA swapped',
    (v) => {
      const a = approval();
      a.headSha2767 = '9'.repeat(40);
      v.comment.body = body(a);
    }
  ],
  [
    'approval own merge SHA missing',
    (v) => {
      const a = approval();
      delete a.mergeSha2767;
      v.comment.body = body(a);
    }
  ],
  [
    'replay with old main',
    (v) => {
      const a = approval();
      a.mainSha = '9'.repeat(40);
      v.comment.body = body(a);
    }
  ],
  [
    'evidence after modified owner comment',
    (v) => {
      v.comment.updated_at = '2026-11-06T01:01:00Z';
    }
  ],
  [
    'incomplete GitHub comment history',
    (v) => {
      v.allComments.pop();
    }
  ]
])
  test('merge attestation HOLD: ' + name, () => {
    const v = evidence();
    alter(v);
    assert.throws(
      () => inspectFreshGitHubOwnerEvidence(v),
      /POINT10X_(?:OWNER|MERGE)_HOLD/u
    );
  });
test('GitHub GET collector refuses open Draft BEFORE any compare, no DB calls', async () => {
  const fixture = evidence();
  fixture.pr2766.merged = false;
  fixture.pr2766.state = 'open';
  fixture.pr2766.draft = true;
  const base = 'https://api.github.com/repos/' + GITHUB_REPO;
  const routes = new Map([
    ['', fixture.repo],
    ['/issues/294', fixture.issue],
    ['/issues/comments/888123', fixture.comment],
    ['/git/ref/heads/main', fixture.mainRef],
    ['/pulls/2762', fixture.pr2762],
    ['/pulls/2766', fixture.pr2766],
    ['/pulls/2767', fixture.pr2767]
  ]);
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(url.slice(base.length));
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.ok(routes.has(url.slice(base.length)));
    return { ok: true, json: async () => routes.get(url.slice(base.length)) };
  };
  try {
    await assert.rejects(
      () =>
        collectGitHubOwnerEvidenceReadOnly({
          token: 'synthetic-never-real-credential',
          commentId: 888123
        }),
      /POINT10X_OWNER_HOLD:MERGE_NOT_CONFIRMED/u
    );
    assert.equal(seen.length, 7);
    assert.equal(
      seen.some((url) => url.includes('compare/')),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('approval body is creatable before GitHub allocates the comment ID', () => {
  const prepared = approval();
  assert.equal(Object.hasOwn(prepared, 'commentId'), false);
  const first = evidence();
  const second = evidence();
  second.comment.id = 900001;
  second.trigger.commentId = 900001;
  second.allComments[2].id = 900001;
  assert.equal(first.comment.body, second.comment.body);
  const result = inspectFreshGitHubOwnerEvidence(second);
  assert.equal(result.commentId, 900001);
  assert.equal(result.status, 'NO_GO_GITHUB_EVIDENCE_SHAPE_ONLY');
  assert.equal(result.ownerAuthenticatedForExecution, false);
  assert.equal(result.controlSpentConsumed, false);
});

test('user-supplied comment ID is rejected even when it matches GitHub', () => {
  assert.throws(
    () => parseExactOwnerScope(body({ ...approval(), commentId: COMMENT_ID })),
    /POINT10X_OWNER_HOLD:NONCANONICAL_OR_DUPLICATE_FIELDS/u
  );
});

test('previous V2 owner comments are rejected by the new V3 contract', () => {
  assert.throws(
    () =>
      parseExactOwnerScope(
        'NOVELIGHT_POINT10X_READONLY_OWNER_V2\n' + sortedJson(approval())
      ),
    /POINT10X_OWNER_HOLD:MARKER_OR_SIZE/u
  );
});
test('legacy OWNER V1 marker is rejected after adding event-bound V3 approval pins', () => {
  assert.equal(OWNER_MARKER, 'NOVELIGHT_POINT10X_READONLY_OWNER_V3');
  assert.throws(
    () =>
      parseExactOwnerScope(
        'NOVELIGHT_POINT10X_READONLY_OWNER_V1\n' + sortedJson(approval())
      ),
    /POINT10X_OWNER_HOLD:MARKER_OR_SIZE/u
  );
});
