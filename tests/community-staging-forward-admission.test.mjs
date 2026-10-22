import test from 'node:test';
import assert from 'node:assert/strict';
import * as gate from '../scripts/community-staging-forward-admission.mjs';
import * as renderer from '../scripts/community-staging-forward-render.mjs';

const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

function fixture() {
  const request = {
    scope: gate.SCOPE,
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
      body: gate.PREFIX + JSON.stringify(request)
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
    ledgerPages: [[{ body: 'unrelated comment' }]]
  };
}
function deny(input, message) {
  assert.throws(() => gate.validateForwardApproval(input), message);
}
function changeRequest(input, key, value) {
  const raw = input.comment.body.slice(gate.PREFIX.length);
  const request = JSON.parse(raw);
  request[key] = value;
  input.comment.body = gate.PREFIX + JSON.stringify(request);
  return input;
}
test('OWNER exact-head and unconsumed scope is accepted', () => {
  const result = gate.validateForwardApproval(fixture());
  assert.equal(result.mainSha, MAIN);
  assert.equal(result.candidateSha, HEAD);
  assert.equal(result.requestId, '1234');
});
test('wrong owner, approval scope, SHA or ancestry fail closed', () => {
  const badActor = fixture();
  badActor.comment.user.login = 'outsider';
  deny(badActor, /OWNER required/u);
  deny(changeRequest(fixture(), 'scope', 'full-smoke'), /unapproved/u);
  deny(changeRequest(fixture(), 'mainSha', HEAD), /unapproved/u);
  const behind = fixture();
  behind.compare.behind_by = 1;
  deny(behind, /descendant/u);
  const truncated = fixture();
  truncated.compare.total_commits = 2;
  deny(truncated, /descendant/u);
});
test('claimed or consumed approvals cannot be reused', () => {
  const claimed = 'NOVELIGHT_STAGING_COMMUNITY_FORWARD_CLAIMED ';
  const consumed = 'NOVELIGHT_STAGING_COMMUNITY_FORWARD_CONSUMED ';
  for (const marker of [claimed, consumed]) {
    const input = fixture();
    const ledger = {
      requestCommentId: '1234',
      mainSha: MAIN,
      candidateSha: HEAD,
      runId: '123'
    };
    if (marker === consumed) ledger.result = 'failed';
    input.ledgerPages[0].push({ body: marker + JSON.stringify(ledger) });
    deny(input, /already claimed/u);
  }
});
test('incomplete ledger and extra fields fail closed', () => {
  const full = fixture();
  full.ledgerPages = [Array(100).fill({ body: 'unrelated comment' })];
  deny(full, /incomplete/u);
  deny(changeRequest(fixture(), 'extra', true), /unexpected fields/u);
});
test('Staging routine catalog guard rejects changed definitions', () => {
  const guard = renderer.composeRoutineBaselineGuard();
  const count = renderer.REVIEWED_STAGING_ROUTINE_COUNT;
  const digest = renderer.REVIEWED_STAGING_ROUTINE_DIGEST;
  assert.equal(count, 19);
  assert.match(digest, /^[0-9a-f]{32}$/u);
  assert.match(guard, /Staging routine fingerprint drift/u);
  assert.match(guard, /pg_get_functiondef/u);
  assert.match(guard, /pg_get_function_identity_arguments/u);
  assert.match(guard, /novelight_save_my_author_note_v2/u);
  assert.match(guard, /novelight_my_seed_community_shares/u);
  assert.match(guard, /novelight_set_my_seed_community_share/u);
  assert.match(guard, new RegExp(digest, 'u'));
});
test('unpinned SQL refused and Git blob hash verified', () => {
  const hash = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
  assert.equal(renderer.gitBlobHash(''), hash);
  const sql = 'SELECT 1;';
  const expected = renderer.REVIEWED_MIGRATION_BLOB;
  const generate = () => renderer.composeReviewedForwardSQL(sql, expected);
  assert.throws(generate, /migration blob drift/u);
});
