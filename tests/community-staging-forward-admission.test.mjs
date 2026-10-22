import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateForwardApproval,
  PREFIX,
  SCOPE
} from '../scripts/community-staging-forward-admission.mjs';
import {
  gitBlobHash,
  composeReviewedForwardSQL,
  REVIEWED_MIGRATION_BLOB
} from '../scripts/community-staging-forward-render.mjs';

const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
function fixture() {
  const request = {
    scope: SCOPE,
    mainSha: MAIN,
    candidateSha: HEAD,
    migration: '20261014052000',
    confirmation: 'STAGING APPROVED'
  };
  return {
    repository: 'bingohooah888-ai/novelrise',
    issue: {
      number: 294,
      state: 'open',
      title: '[Staging Control] Supabase migration sync',
      user: { login: 'bingohooah888-ai' }
    },
    comment: {
      id: 1234,
      user: { login: 'bingohooah888-ai' },
      author_association: 'OWNER',
      body: PREFIX + JSON.stringify(request)
    },
    main: { object: { sha: MAIN } },
    pr: {
      number: 2222,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main', sha: MAIN },
      head: {
        sha: HEAD,
        repo: { full_name: 'bingohooah888-ai/novelrise' }
      }
    },
    compare: {
      status: 'ahead',
      behind_by: 0,
      base_commit: { sha: MAIN },
      total_commits: 1,
      commits: [{ sha: HEAD }]
    },
    ledgerPages: [[{ body: 'ordinary unrelated entry' }]]
  };
}
function modifyRequest(item, patch) {
  const parsed = JSON.parse(item.comment.body.slice(PREFIX.length));
  item.comment.body = PREFIX + JSON.stringify({ ...parsed, ...patch });
  return item;
}
test('accept one exact unconsumed OWNER Staging scope', () => {
  assert.deepEqual(validateForwardApproval(fixture()), {
    mainSha: MAIN,
    candidateSha: HEAD,
    requestId: '1234'
  });
});
test('reject wrong OWNER, scope, SHA and incomplete ancestry', () => {
  const actor = fixture();
  actor.comment.user.login = 'untrusted-user';
  assert.throws(() => validateForwardApproval(actor), /OWNER required/u);
  assert.throws(() => validateForwardApproval(
    modifyRequest(fixture(), { scope: 'full-smoke' })
  ), /unapproved head/u);
  assert.throws(() => validateForwardApproval(
    modifyRequest(fixture(), { mainSha: HEAD })
  ), /unapproved head/u);
  const behind = fixture();
  behind.compare.behind_by = 1;
  assert.throws(() => validateForwardApproval(behind), /descendant/u);
  const truncated = fixture();
  truncated.compare.total_commits = 2;
  assert.throws(() => validateForwardApproval(truncated), /descendant/u);
});
test('reject claimed or consumed one-time approval', () => {
  for (const marker of [
    'NOVELIGHT_STAGING_COMMUNITY_FORWARD_CLAIMED ',
    'NOVELIGHT_STAGING_COMMUNITY_FORWARD_CONSUMED '
  ]) {
    const input = fixture();
    input.ledgerPages[0].push({
      body: marker + JSON.stringify({
        requestCommentId: '1234',
        mainSha: MAIN,
        candidateSha: HEAD,
        runId: '123',
        ...(marker.includes('CONSUMED') ? { result: 'failed' } : {})
      })
    });
    assert.throws(() => validateForwardApproval(input), /already claimed/u);
  }
});
test('fail closed on incomplete ledger or malformed approval record', () => {
  const missing = fixture();
  missing.ledgerPages = [[]];
  assert.doesNotThrow(() => validateForwardApproval(missing));
  const truncated = fixture();
  truncated.ledgerPages = [Array.from(
    { length: 100 }, () => ({ body: 'normal' })
  )];
  assert.throws(() => validateForwardApproval(truncated), /incomplete/u);
  assert.throws(() => validateForwardApproval(
    modifyRequest(fixture(), { unreviewed: true })
  ), /unexpected fields/u);
});
test('refuse unpinned candidate SQL and preserve git blob hashing', () => {
  assert.equal(gitBlobHash(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  assert.match(REVIEWED_MIGRATION_BLOB, /^[a-f0-9]{40}$/u);
  assert.throws(() => composeReviewedForwardSQL(
    'ALTER TABLE public.community_comments ADD COLUMN x int;',
    REVIEWED_MIGRATION_BLOB
  ), /migration blob drift/u);
});
