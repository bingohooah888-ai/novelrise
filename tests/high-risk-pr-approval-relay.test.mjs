import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/high-risk-pr-approval.yml',
  'utf8'
);
const readinessBridgeWorkflow = await readFile(
  '.github/workflows/high-risk-merge-readiness-bridge.yml',
  'utf8'
);
const productionReadinessWorkflow = await readFile(
  '.github/workflows/production-readiness-smoke.yml',
  'utf8'
);

test('relay is owner-only and exact-head bound', () => {
  assert.match(workflow, /issue_comment:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/
  );
  assert.match(
    workflow,
    /github\.event\.comment\.author_association == 'OWNER'/
  );
  assert.match(workflow, /NOVELIGHT_HIGH_RISK_APPROVE/);
  assert.match(workflow, /\.operation == "merge-high-risk-pr"/);
  assert.match(workflow, /\.base\.ref == "main"/);
  assert.match(workflow, /\.head\.repo\.full_name == \$repo/);
  assert.match(workflow, /\.head\.sha == \$sha/);
  assert.match(workflow, /approval challenge does not match the exact PR head/);
});


test('relay grants CI-only least-privilege permissions', () => {
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /issues: read/);
  assert.match(workflow, /pull-requests: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /pull-requests: write/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /secrets\.[A-Z0-9_]*TOKEN/);
});

test('relay checks out trusted main without credentials', () => {
  assert.match(workflow, /Checkout trusted main approval logic/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /ref: main/);
});


test('owner approval must not release Draft or mutate PR review state', () => {
  assert.match(workflow, /Validate owner approval and re-run CI only/);
  assert.doesNotMatch(workflow, /Mark approved draft PR ready for review/);
  assert.doesNotMatch(workflow, /markPullRequestReadyForReview/);
  assert.doesNotMatch(workflow, /gh api graphql/);
  assert.doesNotMatch(workflow, /gh pr ready/);
  assert.doesNotMatch(workflow, /pr-ready-mutation\.json/);
});


test('owner approval retains exact PR identity and fails closed on mismatches', () => {
  assert.match(workflow, /Validate exact PR head and one-time challenge/);
  assert.match(
    workflow,
    /\.state == "open" and \.base\.ref == "main" and \.head\.repo\.full_name == \$repo and \.head\.sha == \$sha/
  );
  assert.match(workflow, /approval PR number does not match this pull request/);
  assert.match(workflow, /approval challenge does not match the exact PR head/);
  assert.match(workflow, /PR is closed, targets another base, or head SHA changed/);
  assert.doesNotMatch(workflow, /\.draft == false/);
});


test('CI rerun follows exact owner and SHA validation without Draft transition', () => {
  const approvalIndex = workflow.indexOf(
    'Validate exact PR head and one-time challenge'
  );
  const rerunIndex = workflow.indexOf(
    'Re-run failed NOVELIGHT CI automatically'
  );
  const waitIndex = workflow.indexOf('Wait for approved-head NOVELIGHT CI success');

  assert.ok(approvalIndex >= 0);
  assert.ok(rerunIndex > approvalIndex);
  assert.ok(waitIndex > rerunIndex);
  assert.match(workflow, /rerun-failed-jobs/);
  assert.match(workflow, /approved-ci\.json/);
  assert.match(workflow, /\.head_sha == \$sha/);
  assert.match(workflow, /NOVELIGHT CI completed with conclusion \$conclusion/);
});


test('owner approval never queues or performs a merge', () => {
  assert.doesNotMatch(workflow, /gh pr merge/);
  assert.doesNotMatch(workflow, /Queue squash auto-merge/);
  assert.doesNotMatch(workflow, /Finalize guarded squash merge/);
  assert.doesNotMatch(workflow, /--match-head-commit/);
  assert.doesNotMatch(workflow, /pr-after-merge-attempt\.json/);
  assert.match(workflow, /Wait for approved-head NOVELIGHT CI success/);
});

test('readiness bridge recovers only a merged exact-owner-approved current main', () => {
  assert.doesNotMatch(
    readinessBridgeWorkflow,
    /github\.event\.workflow_run\.conclusion == 'success'/
  );
  assert.match(
    readinessBridgeWorkflow,
    /if \[ "\$RELAY_CONCLUSION" != 'failure' \]; then/
  );
  assert.match(
    readinessBridgeWorkflow,
    /github\.event\.workflow_run\.conclusion == 'failure'/
  );
  assert.match(readinessBridgeWorkflow, /pull-requests: read/);
  assert.match(readinessBridgeWorkflow, /issues: read/);
  assert.match(readinessBridgeWorkflow, /merge_commit_sha == \$sha/);
  assert.match(
    readinessBridgeWorkflow,
    /scripts\/high-risk-approval-lib\.mjs challenge/
  );
  assert.match(
    readinessBridgeWorkflow,
    /\.body == \$body and \.user\.login == "bingohooah888-ai" and \.author_association == "OWNER"/
  );
  assert.match(
    readinessBridgeWorkflow,
    /lacks exact owner approval for head \$head_sha; skipping readiness recovery/
  );
  assert.match(
    readinessBridgeWorkflow,
    /Recovered safe readiness handoff for PR #\$pr_number at merged main \$current_main/
  );
});

test('readiness bridge remains duplicate-safe', () => {
  assert.match(
    readinessBridgeWorkflow,
    /Production Readiness already exists for current main \$current_main; skipping duplicate dispatch/
  );
  assert.match(
    readinessBridgeWorkflow,
    /production-readiness-smoke\.yml\/dispatches/
  );
});

test('production readiness observes high-risk control workflow changes', () => {
  assert.match(
    productionReadinessWorkflow,
    /'\.github\/workflows\/high-risk-pr-approval\.yml'/
  );
  assert.match(
    productionReadinessWorkflow,
    /'\.github\/workflows\/high-risk-merge-readiness-bridge\.yml'/
  );
});
