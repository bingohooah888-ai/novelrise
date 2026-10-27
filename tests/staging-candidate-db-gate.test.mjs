import assert from 'node:assert/strict';
import test from 'node:test';

import {
  verifyCandidateAdmission,
  expectedCandidateArtifactPaths,
  CLAIM,
  CONSUMED,
  PREFIX
} from '../scripts/staging-candidate-admission.mjs';
import {
  composeCandidateRollbackSql,
  unwrapCandidateSql
} from '../scripts/staging-candidate-sql.mjs';

const M = 'a'.repeat(40);
const H = 'b'.repeat(40);
const K = 'c'.repeat(40);
const version = '20261027120000';
const files = [
  { filename: `supabase/migrations/${version}_ai_runtime.sql`, status: 'added', sha:K },
  { filename: `supabase/checks/${version}_ai_runtime_precheck.sql`, status: 'added', sha:K },
  { filename: `supabase/checks/${version}_ai_runtime_postcheck.sql`, status: 'added', sha:K },
  { filename: `supabase/rollback/${version}_ai_runtime_rollback.sql`, status: 'added', sha:K }
];
function fixture(overrides = {}) {
  return {
    repository: 'bingohooah888-ai/novelrise',
    issue: {
      number: 294, state: 'open',
      title: '[Staging Control] Supabase migration sync',
      user: { login: 'bingohooah888-ai' }
    },
    comment: {
      id: 9940,
      user: { login: 'bingohooah888-ai' },
      author_association: 'OWNER',
      body: PREFIX + JSON.stringify({
        scope: 'candidate-db-rollback-check',
        mainSha: M, candidateSha: H, pr: 2548,
        migration: version, confirmation: 'STAGING APPROVED'
      })
    },
    main: { object: { sha: M } },
    pr: {
      number: 2548, state: 'open', draft: true, merged: false,
      base: { ref: 'main', sha: M },
      head: { repo: { full_name: 'bingohooah888-ai/novelrise' }, sha: H },
      changed_files: files.length
    },
    compare: {
      status: 'ahead', behind_by: 0, ahead_by: 1,
      base_commit: { sha: M },
      total_commits: 1,
      commits: [{ sha: H }]
    },
    files,
    ledgerPages: [[]],
    ...overrides
  };
}

test('one owner-approved draft PR produces four immutable Git blobs', () => {
  const a = verifyCandidateAdmission(fixture());
  assert.equal(a.pr, 2548);
  assert.equal(a.migration, version);
  assert.equal(a.artifacts.migration.sha, K);
  assert.equal(Object.keys(a.artifacts).length, 4);
});

test('invalid owner or wrong issue cannot use Staging approval', () => {
  const o = fixture();
  o.comment.user.login = 'github-actions[bot]';
  assert.throws(() => verifyCandidateAdmission(o), /DENIED/);
  const x=fixture();
  x.issue.number=188;
  assert.throws(() => verifyCandidateAdmission(x), /DENIED/);
});

test('main drift, changed SHA, non-draft or forked PR fail closed', () => {
  for (const alteration of [
    o => { o.main.object.sha = K; },
    o => { o.pr.head.sha = K; },
    o => { o.pr.draft = false; },
    o => { o.pr.head.repo.full_name = 'attacker/fork'; },
    o => { o.pr.base.sha = K; },
    o => { o.compare.behind_by = 1; },
    o => { o.compare.commits = []; }
  ]) {
    const f = fixture();
    alteration(f);
    assert.throws(() => verifyCandidateAdmission(f), /DENIED/);
  }
});

test('single use rejects claimed or consumed request ID', () => {
  for (const prefix of [CLAIM, CONSUMED]) {
    const f=fixture();
    f.ledgerPages=[[{
      body: prefix + JSON.stringify(prefix===CLAIM
        ? { requestCommentId:'9940', mainSha:M, candidateSha:H, runId:'111' }
        : { requestCommentId:'9940', mainSha:M, candidateSha:H, runId:'111',result:'success' })
    }]];
    assert.throws(() => verifyCandidateAdmission(f), /claimed or consumed/);
  }
});

test('rejects missing, modified, duplicate, or unrelated SQL artifacts', () => {
  const changed = files.map(x => ({ ...x }));
  changed[1].status = 'modified';
  assert.throws(() => expectedCandidateArtifactPaths(changed,version), /DENIED/);
  const extra = [...files, {
    filename:'supabase/migrations/20261027121000_other.sql',
    status:'added',sha:K
  }];
  assert.throws(() => expectedCandidateArtifactPaths(extra,version), /DENIED/);
  const missing=files.slice(0,3);
  assert.throws(() => expectedCandidateArtifactPaths(missing,version), /DENIED/);
});

test('candidate SQL is executed inside one protective rollback wrapper', () => {
  const text = composeCandidateRollbackSql({
    precheck:'DO $pre$ BEGIN IF FALSE THEN RAISE EXCEPTION \'x\'; END IF; END $pre$;',
    migration:'-- reviewed\nBEGIN;\nCREATE TABLE public.test_candidate(id integer);\nCOMMIT;',
    postcheck:'SELECT 1;'
  });
  assert.equal((text.match(/^BEGIN;$/gm)||[]).length,1);
  assert.equal((text.match(/^ROLLBACK;$/gm)||[]).length,1);
  assert.equal((text.match(/^COMMIT;$/gm)||[]).length,0);
  assert.match(text,/CREATE TABLE public.test_candidate/);
  assert.ok(text.trimEnd().endsWith('ROLLBACK;'));
});

test('SQL compiler rejects extra commits, shell escapes and non-transactional code', () => {
  for (const sql of [
    'BEGIN; SELECT 1; COMMIT; SELECT 2;',
    'BEGIN; SELECT 1; COMMIT; COMMIT;',
    'BEGIN; SELECT dblink_connect(\'x\'); COMMIT;',
    'BEGIN; CREATE EXTENSION http; COMMIT;',
    'BEGIN; SELECT 1;\\! id\nCOMMIT;'
  ]) {
    assert.throws(() => unwrapCandidateSql(sql,'migration'), /DENIED/);
  }
  assert.throws(() => unwrapCandidateSql('COMMIT;', 'postcheck'), /DENIED/);
});
