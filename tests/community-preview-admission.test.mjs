import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { assertCommunityPreviewAdmission } from '../scripts/community-preview-admission.mjs';

const mainSha = 'a'.repeat(40);
const candidateSha = 'b'.repeat(40);
const owner = 'bingohooah888-ai';
const repo = owner + '/novelrise';

function fixture() {
  const command = {
    scope: 'community-phase1-preview',
    mainSha,
    candidateSha,
    confirmation: 'STAGING APPROVED'
  };
  const issue = {
    id: 999,
    number: 188,
    state: 'open',
    url: 'https://api.github.com/repos/' + repo + '/issues/188',
    title: '[Staging Approval Control] Preview / Staging cost gate',
    user: { login: owner }
  };
  return {
    repository: repo,
    issue,
    liveIssue: { ...issue },
    comment: {
      id: 123,
      user: { login: owner },
      author_association: 'OWNER',
      body:
        'NOVELIGHT_STAGING_COMMUNITY_PREVIEW_APPROVE ' + JSON.stringify(command)
    },
    main: { object: { sha: mainSha } },
    pr: {
      number: 2222,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main', sha: mainSha },
      head: {
        sha: candidateSha,
        repo: { full_name: repo }
      }
    },
    compare: {
      status: 'ahead',
      behind_by: 0,
      ahead_by: 1,
      total_commits: 1,
      base_commit: { sha: mainSha },
      commits: [{ sha: candidateSha }]
    },
    ledgerPages: [[{ body: 'ordinary discussion' }]]
  };
}

test('exact OWNER and candidate contract matches', () => {
  assert.deepEqual(assertCommunityPreviewAdmission(fixture()), {
    mainSha,
    candidateSha,
    requestCommentId: '123'
  });
});

test('reject wrong control issue or not OWNER', () => {
  const wrongIssue = fixture();
  wrongIssue.issue.number = 294;
  assert.throws(
    () => assertCommunityPreviewAdmission(wrongIssue),
    /COMMUNITY_PREVIEW_DENIED/
  );
  const wrongAuthor = fixture();
  wrongAuthor.comment.author_association = 'CONTRIBUTOR';
  assert.throws(
    () => assertCommunityPreviewAdmission(wrongAuthor),
    /COMMUNITY_PREVIEW_DENIED/
  );
});

test('reject changed candidate or divergent ancestry', () => {
  const moved = fixture();
  moved.pr.head.sha = 'f'.repeat(40);
  assert.throws(
    () => assertCommunityPreviewAdmission(moved),
    /COMMUNITY_PREVIEW_DENIED/
  );
  const divergent = fixture();
  divergent.compare.status = 'diverged';
  assert.throws(
    () => assertCommunityPreviewAdmission(divergent),
    /COMMUNITY_PREVIEW_DENIED/
  );
});

test('reject reused and incomplete approval ledgers', () => {
  const reused = fixture();
  reused.ledgerPages = [
    [
      {
        body:
          'NOVELIGHT_STAGING_COMMUNITY_PREVIEW_CLAIMED ' +
          JSON.stringify({
            requestCommentId: '123',
            mainSha,
            candidateSha,
            runId: '1'
          })
      }
    ]
  ];
  assert.throws(
    () => assertCommunityPreviewAdmission(reused),
    /COMMUNITY_PREVIEW_DENIED/
  );
  const incomplete = fixture();
  incomplete.ledgerPages = [];
  assert.throws(
    () => assertCommunityPreviewAdmission(incomplete),
    /COMMUNITY_PREVIEW_DENIED/
  );
});

test('reject unreviewed fork', () => {
  const fork = fixture();
  fork.pr.head.repo.full_name = 'other/repo';
  assert.throws(
    () => assertCommunityPreviewAdmission(fork),
    /COMMUNITY_PREVIEW_DENIED/
  );
});

test('closed issue is denied even with valid OWNER and SHA', () => {
  const closedEvent = fixture();
  closedEvent.issue.state = 'closed';
  assert.throws(
    () => assertCommunityPreviewAdmission(closedEvent),
    /COMMUNITY_PREVIEW_DENIED/
  );
  const closedLive = fixture();
  closedLive.liveIssue.state = 'closed';
  assert.throws(
    () => assertCommunityPreviewAdmission(closedLive),
    /COMMUNITY_PREVIEW_DENIED/
  );
});

test('fresh issue identity, state and existence are mandatory', () => {
  for (const kind of ['missing', 'wrongId', 'wrongUrl', 'wrongOwner']) {
    const x = fixture();
    if (kind === 'missing') delete x.liveIssue;
    if (kind === 'wrongId') x.liveIssue.id += 1;
    if (kind === 'wrongUrl') x.liveIssue.url = 'https://invalid.example/188';
    if (kind === 'wrongOwner') x.liveIssue.user = { login: 'other' };
    assert.throws(
      () => assertCommunityPreviewAdmission(x),
      /COMMUNITY_PREVIEW_DENIED/
    );
  }
});

test('cost-bearing Preview workflow refuses a closed Issue', () => {
  const workflow = readFileSync(
    new URL(
      '../.github/workflows/community-candidate-preview.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(workflow, /github\.event\.issue\.state == 'open'/u);
  assert.match(workflow, /\/tmp\/preview-issue\.json/u);
  assert.match(workflow, /scripts\/community-preview-admission\.mjs/u);
  const rechecks = workflow.match(/--jq '\.state'/gu) ?? [];
  assert.ok(rechecks.length >= 2);
});
