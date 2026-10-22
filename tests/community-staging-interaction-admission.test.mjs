import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCommunityInteractionAdmission,
  SCOPE,
  PREFIX
} from '../scripts/community-staging-interaction-admission.mjs';

const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

function fixture() {
  const approval = {
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
      body: PREFIX + JSON.stringify(approval),
      author_association: 'OWNER',
      user: { login: 'bingohooah888-ai' }
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
      ahead_by: 1,
      total_commits: 1,
      commits: [{ sha: HEAD }]
    },
    ledgerPages: [[{ body: 'Unrelated issue note' }]]
  };
}
function reject(record, message) {
  assert.throws(() => assertCommunityInteractionAdmission(record), message);
}
test('bind an OWNER approval to fresh Draft PR ancestry', () => {
  assert.deepEqual(assertCommunityInteractionAdmission(fixture()), {
    mainSha: MAIN,
    candidateSha: HEAD,
    migration: '20261014052000',
    requestCommentId: '1234'
  });
});
test('reject stale SHA, unauthorized actor or wrong project', () => {
  const author = fixture();
  author.comment.user.login = 'attacker';
  reject(author, /OWNER authorization/u);
  const stale = fixture();
  stale.main.object.sha = HEAD;
  reject(stale, /wrong main/u);
  const fork = fixture();
  fork.pr.head.repo.full_name = 'attacker/novelrise';
  reject(fork, /wrong main/u);
  const notDraft = fixture();
  notDraft.pr.draft = false;
  reject(notDraft, /wrong main/u);
  const closedIssue = fixture();
  closedIssue.issue.state = 'closed';
  reject(closedIssue, /wrong OWNER/u);
});
test('reject incomplete history, unknown scope and divergence', () => {
  const behind = fixture();
  behind.compare.behind_by = 1;
  reject(behind, /not complete/u);
  const partial = fixture();
  partial.compare.total_commits = 2;
  reject(partial, /not complete/u);
  const mismatched = fixture();
  mismatched.comment.body = mismatched.comment.body.replace(
    SCOPE, 'community-phase1-forward-reconcile'
  );
  reject(mismatched, /wrong main/u);
});
test('reject reused approval and truncated ledger', () => {
  for (const suffix of ['CLAIMED ', 'CONSUMED ']) {
    const example = fixture();
    const used = {
      requestCommentId: '1234',
      mainSha: MAIN,
      candidateSha: HEAD,
      runId: '1'
    };
    if (suffix.startsWith('CONSUMED')) used.result = 'success';
    example.ledgerPages[0].push({
      body: 'NOVELIGHT_STAGING_COMMUNITY_INTERACTION_' +
        suffix + JSON.stringify(used)
    });
    reject(example, /already been claimed/u);
  }
  const pages = fixture();
  pages.ledgerPages = [Array(100).fill({ body: 'irrelevant' })];
  reject(pages, /incomplete Staging/u);
});
test('reject unexpected fields in approval and ledger markers', () => {
  const unknown = fixture();
  unknown.comment.body += ' extra';
  reject(unknown, /malformed approval JSON/u);
  const malformed = fixture();
  malformed.ledgerPages[0].push({
    body: 'NOVELIGHT_STAGING_COMMUNITY_INTERACTION_CLAIMED {}'
  });
  reject(malformed, /wrong approval fields/u);
});
