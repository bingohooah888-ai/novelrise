import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/production-auth-beta-email-mode.yml',
  'utf8'
);
const ledger = JSON.parse(
  await readFile('production-approval-ledger.json', 'utf8')
);
const runbookSource = await readFile('docs/BETA-OPERATIONS-RUNBOOK.md', 'utf8');
const checklistSource = await readFile(
  'docs/BETA-RELEASE-CHECKLIST.md',
  'utf8'
);

test('beta no-mail Auth control stays bound to the active Production ledger', () => {
  assert.equal(ledger.activeIssue, 737);
  assert.match(workflow, /LEDGER_ISSUE: '737'/u);
  assert.match(
    workflow,
    /github\.event\.issue\.number == 737[\s\S]*?NOVELIGHT_PRODUCTION_AUTH_BETA_EMAIL_MODE_REQUEST/u
  );
  assert.match(workflow, /production-approval-ledger\.json/u);
});

test('beta no-mail Auth request is PRE_REGISTRATION-only and one-time approved', () => {
  assert.match(workflow, /\.campaign\.state == "PRE_REGISTRATION"/u);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_BETA_EMAIL_MODE_APPROVE/u);
  assert.match(workflow, /auth-beta-email-\[0-9a-f\]\{40\}-\[0-9\]\+/u);
  assert.match(workflow, /expires_at/u);
  assert.match(workflow, /already used/u);
  assert.match(workflow, /main changed after beta Auth email-mode approval/u);
});

test('beta no-mail Auth mutation changes only mailer_autoconfirm', () => {
  assert.match(workflow, /payload='\{"mailer_autoconfirm":true\}'/u);
  assert.match(
    workflow,
    /test "\$\(jq 'keys \| length' <<<"\$payload"\)" -eq 1/u
  );
  assert.doesNotMatch(
    workflow,
    /payload='\{[^\n]*(?:smtp_|hook_send_email|hook_before_user_created)[^\n]*\}'/u
  );
  assert.doesNotMatch(workflow, /supabase db push|stripe|STRIPE_LIVE/u);
});

test('beta no-mail Auth precheck and postcheck preserve security boundaries', () => {
  assert.match(workflow, /\.external_email_enabled == true/u);
  assert.match(workflow, /\.mailer_secure_email_change_enabled == true/u);
  assert.match(workflow, /\.hook_before_user_created_enabled == true/u);
  assert.match(
    workflow,
    /\.hook_before_user_created_uri == \$before\[0\]\.hook_before_user_created_uri/u
  );
  assert.match(workflow, /\.mailer_autoconfirm == true/u);
});

test('beta no-mail Auth control claims, records and rolls back safely', () => {
  const claimIndex = workflow.indexOf(
    'Claim approval before Production Auth mutation'
  );
  const mutationIndex = workflow.indexOf('Enable only beta signup autoconfirm');
  assert.ok(claimIndex >= 0);
  assert.ok(mutationIndex > claimIndex);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_BETA_EMAIL_MODE_CLAIMED/u);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_BETA_EMAIL_MODE_CONSUMED/u);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_BETA_EMAIL_MODE_FAILED/u);
  assert.match(workflow, /\{mailer_autoconfirm:\$value\}/u);
  assert.match(workflow, /auth-rollback\.json/u);
});

test('beta no-mail Auth operations are documented as temporary and preopen-gated', () => {
  assert.match(runbookSource, /Temporary beta no-mail Auth mode/u);
  assert.match(
    runbookSource,
    /NOVELIGHT_PRODUCTION_AUTH_BETA_EMAIL_MODE_REQUEST/u
  );
  assert.match(runbookSource, /mailer_autoconfirm=true/u);
  assert.match(
    runbookSource,
    /This proves preregistration eligibility, not ownership of the inbox/u
  );
  assert.match(
    checklistSource,
    /Temporary beta no-mail Auth mode is deployed and Production-postchecked/u
  );
  assert.match(
    checklistSource,
    /Required before the 2026-09-28 author preopen/u
  );
});
