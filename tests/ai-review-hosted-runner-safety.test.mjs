import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const runner = readFileSync(
  new URL('../scripts/ai-review-hosted-proof-runner.sh', import.meta.url),
  'utf8'
);
const workflow = readFileSync(
  new URL(
    '../.github/workflows/ai-review-hosted-staging-race-proof.yml',
    import.meta.url
  ),
  'utf8'
);

test('hosted writer is inert without a fresh approval and trusted main', () => {
  assert.match(runner, /NOVELIGHT_STAGING_AI_RACE_ADMITTED/u);
  assert.match(runner, /APPROVED_MAIN_SHA/u);
  assert.match(runner, /git rev-parse HEAD/u);
  assert.match(runner, /verify-staging-migration-target\.mjs/u);
  assert.match(runner, /wmlzjgvxgoyrovdhbqbg\.supabase\.co/u);
  assert.doesNotMatch(runner, /fiepaguycecrredwrcwx\.supabase\.co/u);
});

test('fictional users are excluded from public participation', () => {
  assert.match(runner, /raw_app_meta_data/u);
  assert.match(runner, /internal_e2e/u);
  assert.match(runner, /novelight_is_internal_participation_account/u);
  assert.match(runner, /non_fk_residue 1/u);
  assert.match(runner, /status\)\s*VALUES\s*\(\$novel[^\n]+draft/u);
});

test('hosted writer does not report success before guarded cleanup', () => {
  assert.match(runner, /trap cleanup EXIT/u);
  assert.match(runner, /foreign_key_residue/u);
  assert.match(runner, /non_fk_residue/u);
  assert.match(runner, /STAGING_RACE_CLEANUP_FAILED/u);
  assert.match(runner, /STAGING_RACE_RESIDUE/u);
  assert.match(runner, /finished.*==.*1/u);
});

test('workflow pins owner and one-use ledger before Staging access', () => {
  assert.match(workflow, /issue_comment:/u);
  assert.match(workflow, /author_association == 'OWNER'/u);
  assert.match(workflow, /startsWith\(github\.event\.comment\.body/u);
  assert.match(workflow, /NOVELIGHT_STAGING_AI_RACE_PROOF_CLAIMED/u);
  assert.match(workflow, /NOVELIGHT_STAGING_AI_RACE_PROOF_CONSUMED/u);
  assert.match(workflow, /ref: main/u);
  assert.match(workflow, /environment: staging/u);
  assert.match(workflow, /cancel-in-progress: false/u);
});
