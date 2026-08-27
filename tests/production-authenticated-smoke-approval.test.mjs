import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test(
  'production authenticated smoke uses one-time chat approval instead of manual environment approval',
  async () => {
    const workflow = await text(
      '.github/workflows/production-authenticated-smoke.yml'
    );

    assert.match(workflow, /issue_comment:/);
    assert.match(workflow, /issues: write/);
    assert.match(
      workflow,
      /github\.event\.issue\.user\.login == 'github-actions\[bot\]'/
    );
    assert.match(
      workflow,
      /github\.event\.comment\.user\.login == 'bingohooah888-ai'/
    );
    assert.match(
      workflow,
      /github\.event\.comment\.author_association == 'OWNER'/
    );
    assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_SMOKE_REQUEST/);
    assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_SMOKE_APPROVE/);
    assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_SMOKE_CLAIMED/);
    assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED/);
    assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_SMOKE_FAILED/);
    assert.match(
      workflow,
      /Production Authenticated Smoke approval request expired/
    );
    assert.match(
      workflow,
      /main changed after the user approved this Production Authenticated Smoke/
    );
    assert.match(
      workflow,
      /Re-check approved main immediately before Production write/
    );
    assert.doesNotMatch(workflow, /environment: production-approval/);
  }
);

test(
  'production authenticated smoke stays SHA-bound and cleans ephemeral production data',
  async () => {
    const workflow = await text(
      '.github/workflows/production-authenticated-smoke.yml'
    );

    assert.match(
      workflow,
      /ref: \$\{\{ steps\.approval\.outputs\.main_sha \}\}/
    );
    assert.match(workflow, /environment: Production/);
    assert.match(workflow, /Create ephemeral production smoke users/);
    assert.match(
      workflow,
      /Run authenticated production smoke with runner Chrome/
    );
    assert.match(workflow, /Clean ephemeral production smoke data/);
    assert.match(workflow, /if: always\(\)/);
    assert.match(workflow, /production-auth-smoke-fixture\.mjs cleanup/);
    assert.match(workflow, /CHECKOUT_SESSION_PREFIX: cs_live_/);
    assert.doesNotMatch(workflow, /STRIPE_LIVE_SECRET_KEY/);
  }
);
