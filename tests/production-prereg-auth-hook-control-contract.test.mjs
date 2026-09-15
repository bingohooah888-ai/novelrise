import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/production-prereg-auth-hook-control.yml', import.meta.url),
  'utf8'
);

const expectedUri =
  'pg-functions://postgres/public/hook_novelight_beta_signup_gate';

test('Production preregistration Auth hook control is owner- and ledger-gated', () => {
  assert.match(workflow, /github\.event\.issue\.number == 460/);
  assert.match(workflow, /github\.event\.comment\.user\.login == 'bingohooah888-ai'/);
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_HOOK_APPROVE/);
  assert.match(workflow, /enable-preregistration-before-user-created-hook/);
  assert.match(workflow, /main changed after the Production Auth hook approval/);
  assert.match(workflow, /this Production Auth hook approval was already used/);
});

test('Production Auth mutation is pinned to the intended hook and exactly two hosted fields', () => {
  assert.ok(workflow.includes(`HOOK_URI: ${expectedUri}`));
  assert.match(workflow, /hook_before_user_created_enabled: true/);
  assert.match(workflow, /hook_before_user_created_uri: \$uri/);
  assert.match(workflow, /test "\$\(jq 'keys \| length' <<<"\$payload"\)" -eq 2/);
  assert.match(
    workflow,
    /\(\(keys \| sort\) == \(\["hook_before_user_created_enabled", "hook_before_user_created_uri"\] \| sort\)\)/
  );
  assert.match(workflow, /a different Before User Created hook is already enabled/);
  assert.match(workflow, /different disabled Before User Created hook URI is already configured/);
});

test('Production Auth hook control fails closed around campaign and main state', () => {
  assert.match(workflow, /\.state == "PRE_REGISTRATION"/);
  assert.match(workflow, /campaign is no longer PRE_REGISTRATION/);
  assert.match(workflow, /Re-check approved main immediately before claim/);
  assert.match(workflow, /Re-check approved main immediately before Auth mutation/);
  assert.match(workflow, /current_main.*APPROVED_MAIN_SHA/s);
});

test('Hosted Auth hook activation is verified by config GET and blocked direct signup', () => {
  assert.match(workflow, /config\/auth/);
  assert.match(workflow, /Verify hosted Auth hook configuration after mutation/);
  assert.match(workflow, /auth\/v1\/signup/);
  assert.match(workflow, /\[ "\$status" = '403' \]/);
  assert.match(workflow, /先行作者登録期間/);
  assert.match(workflow, /blockedSignupSmoke:\"success\"/);
});

test('A failed post-mutation verification attempts scoped rollback and records evidence', () => {
  assert.match(workflow, /Roll back only this hook mutation after failed verification/);
  assert.match(
    workflow,
    /failure\(\) && steps\.precheck\.outputs\.needs_patch == 'true' && steps\.mutate\.outcome == 'success'/
  );
  assert.match(workflow, /hook_before_user_created_enabled:\$enabled/);
  assert.match(workflow, /hook_before_user_created_uri:\$uri/);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_HOOK_FAILED/);
  assert.match(workflow, /rollback_result/);
});

test('Temporary Auth and API-key material is removed on every outcome', () => {
  assert.match(workflow, /Remove temporary Production Auth files/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /\/tmp\/supabase-api-keys\.json/);
  assert.match(workflow, /\/tmp\/auth-hook-before\.json/);
  assert.match(workflow, /\/tmp\/auth-hook-signup-response\.json/);
});
