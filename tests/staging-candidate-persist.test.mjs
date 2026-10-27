import assert from 'node:assert/strict';
import test from 'node:test';

import {
  verifyCandidateAdmission,
  expectedCandidateArtifactPaths,
  PREFIX, CLAIM, CONSUMED
} from '../scripts/staging-candidate-persist-admission.mjs';
import {
  composeCandidatePersistentSql
} from '../scripts/staging-candidate-persist-sql.mjs';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const blob = 'c'.repeat(40);
const version = '20261027120000';
const filename = version + '_novelight_ai_shared_runtime_foundation.sql';

const files = [
  { filename: 'supabase/migrations/' + filename, sha: blob, status: 'added' },
  { filename: 'supabase/checks/' + version + '_novelight_ai_shared_runtime_foundation_precheck.sql', sha: blob, status: 'added' },
  { filename: 'supabase/checks/' + version + '_novelight_ai_shared_runtime_foundation_postcheck.sql', sha: blob, status: 'added' },
  { filename: 'supabase/rollback/' + version + '_novelight_ai_shared_runtime_foundation_rollback.sql', sha: blob, status: 'added' }
];

function request() {
  return {
    repository: 'bingohooah888-ai/novelrise',
    issue: {
      number: 294, state: 'open', title: '[Staging Control] Supabase migration sync',
      user: { login: 'bingohooah888-ai' }
    },
    comment: {
      id: 772222, user: { login: 'bingohooah888-ai' },
      author_association: 'OWNER',
      body: PREFIX + JSON.stringify({
        scope: 'candidate-db-persist',
        mainSha: base, candidateSha: head, pr: 2548,
        migration: version, confirmation: 'STAGING PERSIST APPROVED'
      })
    },
    main: { object: { sha: base } },
    pr: {
      number: 2548, state: 'open', draft: true, merged: false,
      base: { ref: 'main', sha: base },
      head: { repo: { full_name: 'bingohooah888-ai/novelrise' }, sha: head },
      changed_files: files.length
    },
    compare: {
      status: 'ahead', behind_by: 0, ahead_by: 1,
      base_commit: { sha: base },
      total_commits: 1, commits: [{ sha: head }]
    },
    files: files.map(f => ({ ...f })),
    ledgerPages: [[]]
  };
}

test('persistent Staging admission requires owner and exact immutable draft', () => {
  const approved = verifyCandidateAdmission(request());
  assert.equal(approved.pr, 2548);
  assert.equal(approved.migration, version);
  assert.equal(approved.artifacts.migration.sha, blob);
  for (const mutate of [
    x => { x.pr.draft = false; },
    x => { x.pr.base.sha = head; },
    x => { x.pr.head.sha = base; },
    x => { x.main.object.sha = head; },
    x => { x.comment.user.login = 'github-actions[bot]'; },
    x => { x.comment.author_association = 'COLLABORATOR'; },
    x => { x.compare.behind_by = 1; },
    x => { x.issue.state = 'closed'; }
  ]) {
    const invalid = request();
    mutate(invalid);
    assert.throws(() => verifyCandidateAdmission(invalid), /DENIED/);
  }
});

test('rollback approval never authorizes permanent Staging mutation', () => {
  const r = request();
  r.comment.body = r.comment.body.replace(
    'STAGING_CANDIDATE_PERSIST_APPROVE',
    'STAGING_CANDIDATE_CHECK_APPROVE'
  );
  assert.throws(() => verifyCandidateAdmission(r), /DENIED/);
  const r2 = request();
  r2.comment.body = r2.comment.body.replace(
    'STAGING PERSIST APPROVED', 'STAGING APPROVED'
  );
  assert.throws(() => verifyCandidateAdmission(r2), /DENIED/);
});

test('a CLAIMED or CONSUMED request is never re-used', () => {
  for (const prefix of [CLAIM, CONSUMED]) {
    const x=request();
    x.ledgerPages=[[{
      body: prefix + JSON.stringify({
        requestCommentId: '772222', mainSha: base, candidateSha: head,
        runId: '44444',
        ...(prefix === CONSUMED ? { result: 'failure' } : {})
      })
    }]];
    assert.throws(() => verifyCandidateAdmission(x), /DENIED/);
  }
});

test('requires exactly one new migration and pre/post/rollback companion', () => {
  const paths=expectedCandidateArtifactPaths(files,version);
  assert.equal(Object.keys(paths).length,4);
  assert.throws(() => expectedCandidateArtifactPaths([
    ...files, {filename:'supabase/migrations/20261027130000_other.sql', sha:blob, status:'added'}
  ], version), /DENIED/);
  const changed=files.map(f=>({...f}));
  changed[1].status='modified';
  assert.throws(() => expectedCandidateArtifactPaths(changed,version), /DENIED/);
});

test('atomic Staging SQL commits schema and ledger after the postcheck', () => {
  const sql=composeCandidatePersistentSql({
    version, migrationFile: filename,
    precheck: 'SELECT 1;',
    migration: 'BEGIN;\nCREATE TABLE public.ai_staging_fixture(id bigint);\nCOMMIT;',
    postcheck: 'SELECT 2;'
  });
  assert.equal((sql.match(/^BEGIN;$/gm)||[]).length,1);
  assert.equal((sql.match(/^COMMIT;$/gm)||[]).length,1);
  assert.equal((sql.match(/^ROLLBACK;$/gm)||[]).length,0);
  assert.ok(sql.indexOf('SELECT 2;') < sql.indexOf('INSERT INTO supabase_migrations'));
  assert.ok(sql.indexOf('INSERT INTO supabase_migrations') < sql.lastIndexOf('COMMIT;'));
  assert.match(sql,/novelight_ai_shared_runtime_foundation/);
  assert.match(sql,/already recorded; manual recovery/);
});

test('compiler refuses unexpected migration filename, escapes, and postcheck transaction', () => {
  const good={
    version,migrationFile:filename,
    precheck:'SELECT 1;',
    migration:'BEGIN;\nCREATE TABLE public.new_a(id integer);\nCOMMIT;',
    postcheck:'SELECT 1;'
  };
  for(const partial of [
    {version:'2026_foo'},
    {migrationFile:'../../evil.sql'},
    {migration:'BEGIN;\nSELECT pg_notify(\'evil\', \'leak\');\nCOMMIT;'},
    {migration:'BEGIN;\nSELECT 1;\nCOMMIT;\nDROP TABLE users;'},
    {postcheck:'COMMIT;'}
  ]) {
    assert.throws(()=>composeCandidatePersistentSql({...good,...partial}),/DENIED/);
  }
});
