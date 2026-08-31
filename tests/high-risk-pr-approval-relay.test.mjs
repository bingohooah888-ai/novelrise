import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/high-risk-pr-approval.yml',
  'utf8'
);

test('High-Risk approval relay stays owner-only and exact-head bound', () => {
  assert.match(workflow, /issue_comment:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/
  );
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(workflow, /NOVELIGHT_HIGH_RISK_APPROVE/);
  assert.match(workflow, /\.operation == "merge-high-risk-pr"/);
  assert.match(workflow, /\.base\.ref == "main"/);
  assert.match(workflow, /\.head\.repo\.full_name == \$repo/);
  assert.match(workflow, /\.head\.sha == \$sha/);
  assert.match(workflow, /approval challenge does not match the exact PR head/);
});

test('High-Risk approval relay grants only the permissions required for ready transition and CI rerun', () => {
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /issues: read/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /secrets\.[A-Z0-9_]*TOKEN/);
});

test('High-Risk approval relay uses trusted main without persisting checkout credentials', () => {
  assert.match(workflow, /Checkout trusted main approval logic/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /ref: main/);
});

test('draft ready transition uses one explicit GraphQL mutation and validates the returned head', () => {
  assert.match(workflow, /pr_node_id=.*\.node_id/);
  assert.match(workflow, /gh api graphql/);
  assert.match(workflow, /markPullRequestReadyForReview/);
  assert.match(workflow, /pullRequestId: \$id/);
  assert.match(workflow, /pullRequest \{ number isDraft headRefOid \}/);
  assert.match(
    workflow,
    /\.data\.markPullRequestReadyForReview\.pullRequest\.number == \$pr/
  );
  assert.match(
    workflow,
    /\.data\.markPullRequestReadyForReview\.pullRequest\.isDraft == false/
  );
  assert.match(
    workflow,
    /\.data\.markPullRequestReadyForReview\.pullRequest\.headRefOid == \$sha/
  );
  assert.doesNotMatch(workflow, /gh pr ready/);
});

test('ready transition re-fetches the PR and fails closed if draft or head state is unexpected', () => {
  assert.match(workflow, /pr-ready-after\.json/);
  assert.match(
    workflow,
    /\.head\.sha == \$sha and \.draft == false/
  );
  assert.match(
    workflow,
    /ready-for-review transition failed or PR head changed/
  );
  assert.match(
    workflow,
    /ready-for-review mutation returned an unexpected PR state/
  );
});

test('CI rerun remains downstream of the approved ready transition', () => {
  const readyIndex = workflow.indexOf('Mark approved draft PR ready for review');
  const rerunIndex = workflow.indexOf('Re-run failed NOVELIGHT CI automatically');

  assert.notEqual(readyIndex, -1);
  assert.notEqual(rerunIndex, -1);
  assert.ok(readyIndex < rerunIndex);
  assert.match(workflow, /rerun-failed-jobs/);
});
