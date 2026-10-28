import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
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

test(
  'hosted Staging runner parses as Bash (without executing)',
  { skip: process.platform === 'win32' },
  () => {
    const result = spawnSync(
      'bash',
      ['-n', 'scripts/ai-review-hosted-proof-runner.sh'],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
  }
);

test(
  'hosted Staging runner refuses to run without one-time approval',
  { skip: process.platform === 'win32' },
  () => {
    const result = spawnSync(
      'bash',
      ['scripts/ai-review-hosted-proof-runner.sh'],
      {
        encoding: 'utf8',
        timeout: 5000,
        env: { PATH: process.env.PATH, NOVELIGHT_STAGING_AI_RACE_ADMITTED: '0' }
      }
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /missing dedicated one-time Staging race admission/u
    );
  }
);

test('Staging runner joins both clients before cleanup', () => {
  assert.match(runner, /wait "$pa" 2>/dev/null || true/u);
  assert.match(runner, /wait "$pb" 2>/dev/null || true/u);
});
