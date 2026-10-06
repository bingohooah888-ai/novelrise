import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/staging-live-proof.yml',
  'utf8'
);

test('Staging Live Proof is approval-only and exact-target bound', () => {
  assert.match(workflow, /issue_comment:/);
  assert.doesNotMatch(workflow, /deployment_status:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /github\.event\.issue\.number == 188/);
  assert.match(
    workflow,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/
  );
  assert.match(
    workflow,
    /github\.event\.comment\.author_association == 'OWNER'/
  );
  assert.match(workflow, /NOVELIGHT_STAGING_APPROVE \{"scope":"live-proof",/);
  assert.match(
    workflow,
    /keys == \["confirmation","mainSha","previewUrl","scope"\]/
  );
  assert.match(workflow, /STAGING APPROVED/);
  assert.match(workflow, /\^https:\/\/\[\^\/\]\+\$/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /git\/ref\/heads\/main/);
  assert.match(workflow, /\/api\/deployment-revision/);
  assert.match(workflow, /deployed_revision.*EXPECTED_REVISION/);
  assert.doesNotMatch(workflow, /branch_slug/);
  assert.doesNotMatch(workflow, /novelrise-git-\$\{branch_slug\}/);
});

test('Staging Live Proof remains fail closed against Production Supabase', () => {
  assert.match(workflow, /PRODUCTION_SUPABASE_HOST/);
  assert.match(workflow, /Preview returned Production Supabase host/);
  assert.match(workflow, /Preview returned a non-Supabase host/);
  assert.match(workflow, /Preview exposed a secret-class key/);
});
