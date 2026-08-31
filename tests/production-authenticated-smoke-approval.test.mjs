import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const handlerPath = '.github/workflows/production-authenticated-smoke.yml';
const requestPath = '.github/workflows/production-auth-smoke-request.yml';

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('auth smoke approval handler uses one-time chat approval', async () => {
  const workflow = await text(handlerPath);
  const botOwner = "github.event.issue.user.login == 'github-actions[bot]'";
  const ownerLogin = "github.event.comment.user.login == 'bingohooah888-ai'";
  const ownerRole = "github.event.comment.author_association == 'OWNER'";
  const expiry = 'Production Authenticated Smoke approval request expired';
  const recheck = 'Re-check approved main immediately before Production write';

  assert.ok(workflow.startsWith('name: NOVELIGHT Production Auth Smoke Approval Handler'));
  assert.ok(workflow.includes('issue_comment:'));
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.ok(workflow.includes('issues: write'));
  assert.ok(workflow.includes(botOwner));
  assert.ok(workflow.includes(ownerLogin));
  assert.ok(workflow.includes(ownerRole));
  assert.ok(workflow.includes('NOVELIGHT_PRODUCTION_AUTH_SMOKE_APPROVE'));
  assert.ok(workflow.includes('NOVELIGHT_PRODUCTION_AUTH_SMOKE_CLAIMED'));
  assert.ok(workflow.includes('NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED'));
  assert.ok(workflow.includes('NOVELIGHT_PRODUCTION_AUTH_SMOKE_FAILED'));
  assert.ok(workflow.includes(expiry));
  assert.ok(workflow.includes(recheck));
  assert.ok(!workflow.includes('environment: production-approval'));
});

test('request creation is a separately named workflow, not smoke proof', async () => {
  const handler = await text(handlerPath);
  const request = await text(requestPath);

  assert.ok(request.startsWith('name: NOVELIGHT Production Auth Smoke Request'));
  assert.ok(request.includes('push:'));
  assert.ok(request.includes('workflow_dispatch:'));
  assert.ok(request.includes('Create scoped chat approval request'));
  assert.ok(request.includes('NOVELIGHT_PRODUCTION_AUTH_SMOKE_REQUEST'));
  assert.ok(!request.includes('Verify authenticated beta-critical production flows'));
  assert.ok(!request.includes('environment: Production'));
  assert.ok(!request.includes('SUPABASE_ACCESS_TOKEN'));

  assert.ok(!handler.includes('\n  push:\n'));
  assert.ok(!handler.includes('\n  request-approval:\n'));
  assert.ok(handler.includes('production-auth-smoke-request.yml/dispatches'));
});

test('only the verification job is authoritative Auth Smoke PASS evidence', async () => {
  const workflow = await text(handlerPath);

  assert.ok(workflow.includes('name: Verify authenticated beta-critical production flows'));
  assert.ok(workflow.includes("github.event_name == 'issue_comment'"));
  assert.ok(workflow.includes("startsWith(github.event.comment.body, 'NOVELIGHT_PRODUCTION_AUTH_SMOKE_APPROVE ')"));
  assert.ok(workflow.includes('if: success() && steps.approval.outputs.request_id !='));
  assert.ok(workflow.includes('NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED'));
  assert.ok(workflow.includes('if: failure() && steps.approval.outputs.request_id !='));
  assert.ok(workflow.includes('NOVELIGHT_PRODUCTION_AUTH_SMOKE_FAILED'));
});

test('auth smoke stays SHA-bound and always cleans up', async () => {
  const workflow = await text(handlerPath);
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

test('request workflow stays SHA-bound before creating approval issue', async () => {
  const request = await text(requestPath);
  const requestGroup = 'novelight-production-auth-request-${{ github.sha }}';
  const staleRequest = 'Skipping approval request: run SHA';
  const currentMainLookup = '"repos/$GITHUB_REPOSITORY/git/ref/heads/main"';
  const requestLookup = request.indexOf('existing="$(gh issue list');

  assert.ok(request.includes(requestGroup));
  assert.ok(request.includes(staleRequest));
  assert.ok(request.includes('is not current main $current_main.'));
  assert.ok(request.includes(currentMainLookup));
  assert.ok(request.indexOf(currentMainLookup) < requestLookup);
});
