import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/staging-live-proof.yml',
  'utf8'
);

test('Staging Live Proof binds only to a real Vercel deployment URL and revision', () => {
  assert.match(workflow, /deployment_status:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /github\.event\.deployment_status\.environment_url/);
  assert.match(
    workflow,
    /github\.event\.deployment_status\.environment_url != ''/
  );
  assert.match(
    workflow,
    /contains\(github\.event\.deployment_status\.environment_url, '\.vercel\.app'\)/
  );
  assert.doesNotMatch(workflow, /DEPLOYMENT_TARGET_URL/);
  assert.match(workflow, /github\.event\.deployment\.sha/);
  assert.match(workflow, /\/api\/deployment-revision/);
  assert.match(workflow, /deployed_revision.*EXPECTED_REVISION/);
  assert.doesNotMatch(workflow, /branch_slug/);
  assert.doesNotMatch(workflow, /novelrise-git-\$\{branch_slug\}/);
});

test('manual Staging Live Proof requires an exact URL and revision', () => {
  assert.match(workflow, /preview_url:[\s\S]*required: true/);
  assert.match(workflow, /revision:[\s\S]*required: true/);
  assert.match(workflow, /\^https:\/\/\[\^\/\]\+\$/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
});

test('Staging Live Proof remains fail closed against Production Supabase', () => {
  assert.match(workflow, /PRODUCTION_SUPABASE_HOST/);
  assert.match(workflow, /Preview returned Production Supabase host/);
  assert.match(workflow, /Preview returned a non-Supabase host/);
  assert.match(workflow, /Preview exposed a secret-class key/);
});
