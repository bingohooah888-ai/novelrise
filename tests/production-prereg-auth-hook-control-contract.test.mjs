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

test('Hosted Auth runtime gets a bounded reload wait before verification', () => {
  const waitIndex = workflow.indexOf(
    'Allow hosted Auth runtime to reload hook configuration'
  );
  const smokeIndex = workflow.indexOf(
    'Retrieve a public Supabase API key for blocked-signup smoke'
  );

  assert.ok(waitIndex >= 0);
  assert.ok(smokeIndex > waitIndex);
  assert.match(workflow, /sleep 20/);
  assert.match(
    workflow,
    /if: steps\.precheck\.outputs\.needs_patch == 'true'/
  );
});

test('Production Auth hook activation verifies blocked signup', () => {
  assert.match(
    workflow,
    /Verify hosted Auth hook configuration after mutation/
  );
  assert.match(workflow, /auth\/v1\/signup/);
  assert.match(workflow, /@novelrise\.vercel\.app/);
  assert.doesNotMatch(workflow, /@example\.com/);
  assert.match(workflow, /\[ "\$status" = '403' \]/);
  assert.match(workflow, /\[ "\$status" = '400' \]/);
  assert.match(workflow, /先行作者登録期間/);
  assert.match(workflow, /blockedSignupSmoke:\"success\"/);
});

test('429 signup rate limits use a no-email admin hook fallback', () => {
  assert.match(workflow, /\[ "\$status" != '429' \]/);
  assert.match(workflow, /auth\/v1\/admin\/generate_link/);
  assert.match(
    workflow,
    /\{type:\"signup\",email:\$email,password:\$password\}/
  );
  assert.match(workflow, /select\(\.type == "secret"\)/);
  assert.match(workflow, /select\(\.name == "service_role"\)/);
  assert.match(workflow, /verification_path=admin-generate-link-fallback/);
  assert.match(workflow, /verificationPath:\$verificationPath/);
});

test('Unexpected fallback user creation is deleted and fails closed', () => {
  assert.match(workflow, /\[ "\$fallback_status" = '200' \]/);
  assert.match(workflow, /\.id \/\/ \.user\.id \/\/ empty/);
  assert.match(workflow, /auth\/v1\/admin\/users\/\$created_user_id/);
  assert.match(workflow, /-X DELETE/);
  assert.match(workflow, /fallback unexpectedly allowed user creation/);
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
  assert.match(workflow, /\/tmp\/auth-hook-generate-link-response\.json/);
  assert.match(workflow, /\/tmp\/auth-hook-fallback-cleanup-response\.json/);
});
