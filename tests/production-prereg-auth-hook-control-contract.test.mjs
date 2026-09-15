import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const workflow = read(
  '.github/workflows/production-prereg-auth-hook-control.yml'
);

test('Production Auth hook control is owner-gated', () => {
  assert.match(workflow, /github\.event\.issue\.number == 460/);
  assert.match(
    workflow,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/
  );
  assert.match(
    workflow,
    /github\.event\.comment\.author_association == 'OWNER'/
  );
  assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_HOOK_APPROVE/);
  assert.match(workflow, /enable-preregistration-before-user-created-hook/);
  assert.match(workflow, /this Production Auth hook approval was already used/);
});

test('Production Auth hook mutation is narrowly scoped', () => {
  assert.match(
    workflow,
    /HOOK_URI: pg-functions:\/\/postgres\/public\/hook_novelight_beta_signup_gate/
  );
  assert.match(workflow, /hook_before_user_created_enabled: true/);
  assert.match(workflow, /hook_before_user_created_uri: \$uri/);
  assert.match(
    workflow,
    /a different Before User Created hook is already enabled/
  );
  assert.match(
    workflow,
    /different disabled Before User Created hook URI is already configured/
  );
});

test('Production Auth hook control fails closed', () => {
  assert.match(workflow, /\.state == "PRE_REGISTRATION"/);
  assert.match(workflow, /campaign is no longer PRE_REGISTRATION/);
  assert.match(workflow, /Re-check approved main immediately before claim/);
  assert.match(
    workflow,
    /Re-check approved main immediately before Auth mutation/
  );
  assert.match(
    workflow,
    /main changed before the Production Auth hook mutation/
  );
});

test('Production Auth hook activation verifies blocked signup', () => {
  assert.match(
    workflow,
    /Verify hosted Auth hook configuration after mutation/
  );
  assert.match(workflow, /auth\/v1\/signup/);
  assert.match(workflow, /\[ "\$status" = '403' \]/);
  assert.match(workflow, /先行作者登録期間/);
  assert.match(workflow, /blockedSignupSmoke:\"success\"/);
});

test('Failed verification rolls the hook back', () => {
  assert.match(
    workflow,
    /Roll back only this hook mutation after failed verification/
  );
  assert.match(workflow, /hook_before_user_created_enabled:\$enabled/);
  assert.match(workflow, /hook_before_user_created_uri:\$uri/);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_HOOK_FAILED/);
  assert.match(workflow, /rollback_result/);
});

test('Temporary Production Auth files are always removed', () => {
  assert.match(workflow, /Remove temporary Production Auth files/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /\/tmp\/supabase-api-keys\.json/);
  assert.match(workflow, /\/tmp\/auth-hook-before\.json/);
  assert.match(workflow, /\/tmp\/auth-hook-signup-response\.json/);
});
