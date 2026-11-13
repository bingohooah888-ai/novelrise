import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREFIX,
  CLAIM,
  CONSUMED,
  SCOPE,
  STAGING_REF,
  verifyScoutPointTenfoldAdmission,
  scoutPointTenfoldSqlPins
} from '../scripts/scout-point10x-staging-admission.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const M = 'a'.repeat(40),
  H = 'b'.repeat(40),
  OWNER = 'bingohooah888-ai',
  VER = '20261105100000';
const paths = {
  migration: 'supabase/migrations/' + VER + '_reader_reward_point10x.sql',
  precheck: 'supabase/checks/' + VER + '_reader_reward_point10x_precheck.sql',
  postcheck: 'supabase/checks/' + VER + '_reader_reward_point10x_postcheck.sql',
  rollback: 'supabase/rollback/' + VER + '_reader_reward_point10x_rollback.sql'
};
const files = Object.values(paths).map((filename, i) => ({
  filename,
  sha: ('c' + i).padEnd(40, 'c'),
  status: 'added'
}));
const fields = () => ({
  scope: SCOPE,
  mode: 'rollback-only',
  mainSha: M,
  candidateSha: H,
  pr: 3040,
  stagingRef: STAGING_REF,
  version: VER,
  confirmation: 'STAGING APPROVED'
});
const fixture = () => ({
  repository: OWNER + '/novelrise',
  actor: OWNER,
  triggeringActor: OWNER,
  issue: {
    number: 294,
    state: 'open',
    title: '[Staging Control] Supabase migration sync',
    user: { login: OWNER }
  },
  comment: {
    id: 8881,
    body: PREFIX + JSON.stringify(fields()),
    user: { login: OWNER },
    author_association: 'OWNER'
  },
  main: { object: { sha: M } },
  pr: {
    number: 3040,
    state: 'open',
    draft: true,
    merged: false,
    base: { ref: 'main', sha: M },
    head: { repo: { full_name: OWNER + '/novelrise' }, sha: H },
    changed_files: files.length
  },
  compare: {
    status: 'ahead',
    behind_by: 0,
    base_commit: { sha: M },
    total_commits: 1,
    commits: [{ sha: H }]
  },
  files: clone(files),
  ledgerPages: [[{ body: 'ordinary non-matching comment' }]]
});
function denied(mod) {
  assert.throws(
    () => verifyScoutPointTenfoldAdmission({ ...fixture(), ...mod }),
    /SCOUT_POINT10X_STAGING_DENIED/
  );
}
function withRequest(patch) {
  const f = fixture();
  f.comment.body = PREFIX + JSON.stringify({ ...fields(), ...patch });
  return f;
}
function inspect(x) {
  const r = verifyScoutPointTenfoldAdmission(x);
  assert.equal(r.scope, SCOPE);
  assert.equal(r.mayPersistStaging, false);
  assert.equal(r.mayWriteProduction, false);
  assert.equal(r.requiresBackupRestoreProof, true);
  return r;
}

test('single canonical OWNER approval binds exact main, candidate, Issue #294 and Staging ref', () => {
  const result = inspect(fixture());
  assert.equal(result.pr, 3040);
  assert.equal(result.mainSha, M);
  assert.equal(result.candidateSha, H);
  assert.equal(result.requestCommentId, '8881');
  assert.equal(result.stagingRef, STAGING_REF);
});
test('approval only ever grants rollback-only evidence mode', () => {
  const result = inspect(fixture());
  assert.equal(result.mode, 'rollback-only');
});
test('four exact SHA-pinned SQL artifacts are enforced', () => {
  const x = inspect(fixture());
  assert.deepEqual(Object.keys(x.artifacts).sort(), [
    'migration',
    'postcheck',
    'precheck',
    'rollback'
  ]);
  assert.equal(x.artifacts.migration.sha, files[0].sha);
});
test('wrong repository fails closed', () =>
  denied({ repository: 'attacker/repo' }));
test('actor must be actual OWNER, not bot', () =>
  denied({ actor: 'github-actions[bot]' }));
test('triggering actor must also be OWNER', () =>
  denied({ triggeringActor: 'github-actions[bot]' }));
test('issue number cannot be switched from 294', () =>
  denied({ issue: { ...fixture().issue, number: 188 } }));
test('issue must be open', () =>
  denied({ issue: { ...fixture().issue, state: 'closed' } }));
test('issue title cannot drift', () =>
  denied({ issue: { ...fixture().issue, title: 'different' } }));
test('issue itself must belong to OWNER', () =>
  denied({ issue: { ...fixture().issue, user: { login: 'other' } } }));
test('cannot accept a PR comment as Issue comment', () =>
  denied({ issue: { ...fixture().issue, pull_request: { url: 'x' } } }));
test('comment must be by OWNER', () =>
  denied({ comment: { ...fixture().comment, user: { login: 'attacker' } } }));
test('comment must carry GitHub author_association OWNER', () =>
  denied({ comment: { ...fixture().comment, author_association: 'MEMBER' } }));
test('comment identifier must be immutable positive integer', () =>
  denied({ comment: { ...fixture().comment, id: 0 } }));
test('wrong prefix rejected', () =>
  denied({
    comment: {
      ...fixture().comment,
      body: 'NOVELIGHT_STAGING_APPROVE ' + JSON.stringify(fields())
    }
  }));
test('unknown scope rejected', () =>
  assert.throws(() =>
    verifyScoutPointTenfoldAdmission(withRequest({ scope: 'migration-sync' }))
  ));
test('persistent Staging mode rejected', () =>
  assert.throws(() =>
    verifyScoutPointTenfoldAdmission(withRequest({ mode: 'persistent' }))
  ));
test('wrong Staging ref or Production ref rejected', () => {
  for (const stagingRef of ['fiepaguycecrredwrcwx', 'invalid'])
    assert.throws(() =>
      verifyScoutPointTenfoldAdmission(withRequest({ stagingRef }))
    );
});
test('wrong confirmation rejected', () =>
  assert.throws(() =>
    verifyScoutPointTenfoldAdmission(withRequest({ confirmation: 'YES' }))
  ));
test('unknown JSON field rejected', () =>
  assert.throws(() =>
    verifyScoutPointTenfoldAdmission(withRequest({ extra: 'enable' }))
  ));
test('invalid main SHA in comment rejected', () =>
  assert.throws(() =>
    verifyScoutPointTenfoldAdmission(withRequest({ mainSha: '123' }))
  ));
test('candidate SHA mismatched from PR rejected', () =>
  assert.throws(() =>
    verifyScoutPointTenfoldAdmission(
      withRequest({ candidateSha: 'c'.repeat(40) })
    )
  ));
test('main SHA drift rejected', () =>
  denied({ main: { object: { sha: 'f'.repeat(40) } } }));
test('candidate cannot equal main SHA', () =>
  assert.throws(() =>
    verifyScoutPointTenfoldAdmission(withRequest({ candidateSha: M }))
  ));
test('candidate PR number is bound to the comment', () =>
  assert.throws(() =>
    verifyScoutPointTenfoldAdmission(withRequest({ pr: 3041 }))
  ));
test('candidate PR must be open and Draft', () =>
  denied({ pr: { ...fixture().pr, draft: false } }));
test('merged PR cannot be used', () =>
  denied({ pr: { ...fixture().pr, merged: true } }));
test('base must be latest main', () =>
  denied({
    pr: { ...fixture().pr, base: { ref: 'main', sha: 'f'.repeat(40) } }
  }));
test('forked candidate PR rejected', () =>
  denied({
    pr: { ...fixture().pr, head: { repo: { full_name: 'fork/repo' }, sha: H } }
  }));
test('PR head SHA drift rejected', () =>
  denied({
    pr: {
      ...fixture().pr,
      head: { repo: { full_name: OWNER + '/novelrise' }, sha: 'd'.repeat(40) }
    }
  }));
test('changed_files count mismatch rejected', () =>
  denied({ pr: { ...fixture().pr, changed_files: 99 } }));
test('candidate behind latest main rejected', () =>
  denied({ compare: { ...fixture().compare, behind_by: 1 } }));
test('missing compare history rejected', () =>
  denied({ compare: { ...fixture().compare, commits: [] } }));
test('ledger must include complete last page', () =>
  denied({
    ledgerPages: [Array.from({ length: 100 }, () => ({ body: 'foo' }))]
  }));
test('ledger more than 40 pages rejected', () =>
  denied({ ledgerPages: Array.from({ length: 41 }, () => []) }));
test('a matching CLAIMED entry always rejects reuse', () => {
  const f = fixture();
  f.ledgerPages = [
    [
      {
        body:
          CLAIM +
          JSON.stringify({
            requestCommentId: '8881',
            mainSha: M,
            candidateSha: H,
            runId: '98765'
          })
      }
    ]
  ];
  assert.throws(() => verifyScoutPointTenfoldAdmission(f));
});
test('a matching CONSUMED entry always rejects reuse', () => {
  const f = fixture();
  f.ledgerPages = [
    [
      {
        body:
          CONSUMED +
          JSON.stringify({
            requestCommentId: '8881',
            mainSha: M,
            candidateSha: H,
            runId: '98765',
            result: 'failure'
          })
      }
    ]
  ];
  assert.throws(() => verifyScoutPointTenfoldAdmission(f));
});
test('unrelated old requests do not authorize this request, but cannot block it', () => {
  const f = fixture();
  f.ledgerPages = [
    [
      {
        body:
          CLAIM +
          JSON.stringify({
            requestCommentId: '111',
            mainSha: M,
            candidateSha: H,
            runId: '55'
          })
      }
    ]
  ];
  inspect(f);
});
test('missing migration SQL or rollback SQL fails closed', () => {
  for (const i of [0, 3]) {
    const f = fixture();
    f.files.splice(i, 1);
    f.pr.changed_files = f.files.length;
    assert.throws(() => verifyScoutPointTenfoldAdmission(f));
  }
});
test('renamed, modified or removed SQL is rejected', () => {
  for (const status of ['modified', 'removed', 'renamed']) {
    const f = fixture();
    f.files[0].status = status;
    assert.throws(() => verifyScoutPointTenfoldAdmission(f));
  }
});
test('an adjacent unrelated SQL migration is rejected', () => {
  const f = fixture();
  f.files.push({
    filename: 'supabase/migrations/' + VER + '_hidden.sql',
    sha: 'e'.repeat(40),
    status: 'added'
  });
  f.pr.changed_files = f.files.length;
  assert.throws(() => verifyScoutPointTenfoldAdmission(f));
});
test('candidate cannot carry modified workflow, API, script or MASTER', () => {
  for (const path of [
    '.github/workflows/safety.yml',
    'scripts/hello.mjs',
    'api/admin.js',
    'docs/NOVELIGHT-MASTER.md',
    'AGENTS.md'
  ]) {
    const f = fixture();
    f.files.push({ filename: path, sha: 'e'.repeat(40), status: 'added' });
    f.pr.changed_files = f.files.length;
    assert.throws(() => verifyScoutPointTenfoldAdmission(f), path);
  }
});
test('bad version, missing blob sha and duplicate exact file fail closed', () => {
  assert.throws(() => scoutPointTenfoldSqlPins(files, '202601'));
  const a = clone(files);
  a[0].sha = 'invalid';
  assert.throws(() => scoutPointTenfoldSqlPins(a, VER));
  const b = clone(files);
  b.push({ ...b[0] });
  assert.throws(() => scoutPointTenfoldSqlPins(b, VER));
});
test('input malformed JSON and noncanonical comment fields fail closed', () => {
  for (const body of [
    PREFIX + '{',
    PREFIX + '[]',
    PREFIX + JSON.stringify({ ...fields(), pr: '3040' }) + ' trailing'
  ]) {
    const f = fixture();
    f.comment.body = body;
    assert.throws(() => verifyScoutPointTenfoldAdmission(f));
  }
});
test('a fully populated but candidate SQL-free CURRENT PR #2762 cannot be admitted', () => {
  const f = fixture();
  f.comment.body = PREFIX + JSON.stringify({ ...fields(), pr: 2762 });
  f.pr.number = 2762;
  f.files = [];
  f.pr.changed_files = 0;
  assert.throws(() => verifyScoutPointTenfoldAdmission(f));
});
test('no output can activate Production, persist Staging or authorize main merge', () => {
  const x = inspect(fixture());
  assert.equal(x.mayWriteProduction, false);
  assert.equal(x.mayPersistStaging, false);
  assert.equal(Object.isFrozen(x), true);
  assert.equal(Object.isFrozen(x.artifacts), true);
});
