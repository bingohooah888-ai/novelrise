import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const workflowPath = '.github/workflows/production-authenticated-smoke.yml';

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('auth smoke uses one-time chat approval', async () => {
  const workflow = await text(workflowPath);
  const botOwner = "github.event.issue.user.login == 'github-actions[bot]'";
  const ownerLogin = "github.event.comment.user.login == 'bingohooah888-ai'";
  const ownerRole = "github.event.comment.author_association == 'OWNER'";
  const expiry = 'Production Authenticated Smoke approval request expired';
  const recheck = 'Re-check approved main immediately before Production write';

  assert.ok(workflow.includes('issue_comment:'));
  assert.ok(workflow.includes('issues: write'));
  assert.ok(workflow.includes(botOwner));
  assert.ok(workflow.includes(ownerLogin));
  assert.ok(workflow.includes(ownerRole));
  assert.ok(workflow.includes('NOVELIGHT_PRODUCTION_AUTH_SMOKE_REQUEST'));
  assert.ok(workflow.includes('NOVELIGHT_PRODUCTION_AUTH_SMOKE_APPROVE'));
  assert.ok(workflow.includes('NOVELIGHT_PRODUCTION_AUTH_SMOKE_CLAIMED'));
  assert.ok(workflow.includes('NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED'));
  assert.ok(workflow.includes('NOVELIGHT_PRODUCTION_AUTH_SMOKE_FAILED'));
  assert.ok(workflow.includes(expiry));
  assert.ok(workflow.includes(recheck));
  assert.ok(!workflow.includes('environment: production-approval'));
});

test('auth smoke stays SHA-bound and always cleans up', async () => {
  const workflow = await text(workflowPath);
  const approvedRef = 'ref: ${{ steps.approval.outputs.main_sha }}';

  assert.ok(workflow.includes(approvedRef));
  assert.ok(workflow.includes('environment: Production'));
  assert.ok(workflow.includes('Create ephemeral production smoke users'));
  assert.ok(workflow.includes('Run authenticated production smoke'));
  assert.ok(workflow.includes('Clean ephemeral production smoke data'));
  assert.ok(workflow.includes('if: always()'));
  assert.ok(workflow.includes('production-auth-smoke-fixture.mjs cleanup'));
  assert.ok(workflow.includes('CHECKOUT_SESSION_PREFIX: cs_live_'));
  assert.ok(!workflow.includes('STRIPE_LIVE_SECRET_KEY'));
});

test('auth smoke keeps unrelated comments out of the production concurrency queue', async () => {
  const workflow = await text(workflowPath);
  const jobsIndex = workflow.indexOf('\njobs:\n');
  const beforeJobs = workflow.slice(0, jobsIndex);
  const requestConcurrency = 'group: novelight-production-auth-request-${{ github.sha }}';
  const executionConcurrency = 'group: novelight-production-authenticated-smoke-execution';
  const legacyConcurrency = 'group: novelight-production-authenticated-smoke\n';
  const staleRequestMessage = 'Skipping approval request: run SHA $GITHUB_SHA is not current main $current_main.';
  const currentMainLookup = '"repos/$GITHUB_REPOSITORY/git/ref/heads/main"';

  assert.ok(jobsIndex > 0);
  assert.ok(!beforeJobs.includes('\nconcurrency:\n'));
  assert.ok(workflow.includes(requestConcurrency));
  assert.ok(workflow.includes(executionConcurrency));
  assert.ok(!workflow.includes(legacyConcurrency));
  assert.ok(workflow.includes(staleRequestMessage));
  assert.ok(workflow.includes(currentMainLookup));
  assert.ok(workflow.indexOf(currentMainLookup) < workflow.indexOf('existing="$(gh issue list'));
});
