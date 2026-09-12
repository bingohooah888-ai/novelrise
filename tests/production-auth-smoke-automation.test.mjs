import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readinessWorkflow = readFileSync(
  '.github/workflows/production-readiness-smoke.yml',
  'utf8'
);
const staleRecoveryWorkflow = readFileSync(
  '.github/workflows/production-auth-smoke-stale-recovery.yml',
  'utf8'
);

test('production readiness automatically opens the next Auth Smoke approval request', () => {
  assert.match(readinessWorkflow, /actions: write/);
  assert.match(readinessWorkflow, /tests\/e2e\/production-auth\/\*\*/);
  assert.match(
    readinessWorkflow,
    /production-auth-smoke-stale-recovery\.yml/
  );
  assert.match(
    readinessWorkflow,
    /Dispatch scoped Production Auth Smoke approval request/
  );
  assert.match(
    readinessWorkflow,
    /if: success\(\) && github\.event_name != 'schedule'/
  );
  assert.match(
    readinessWorkflow,
    /actions\/workflows\/production-auth-smoke-request\.yml\/dispatches/
  );
  assert.match(readinessWorkflow, /current_main.*GITHUB_SHA/s);
});

test('stale Production Auth Smoke approval recovers without another Run workflow click', () => {
  assert.match(staleRecoveryWorkflow, /issue_comment:/);
  assert.match(staleRecoveryWorkflow, /author_association == 'OWNER'/);
  assert.match(
    staleRecoveryWorkflow,
    /NOVELIGHT_PRODUCTION_AUTH_SMOKE_APPROVE /
  );
  assert.match(staleRecoveryWorkflow, /current_main.*approved_sha/s);
  assert.match(
    staleRecoveryWorkflow,
    /NOVELIGHT_PRODUCTION_AUTH_SMOKE_FAILED /
  );
  assert.match(staleRecoveryWorkflow, /gh issue close/);
  assert.match(staleRecoveryWorkflow, /production-readiness-smoke\.yml/);
  assert.match(staleRecoveryWorkflow, /production-auth-smoke-request\.yml/);
  assert.match(
    staleRecoveryWorkflow,
    /actions\/workflows\/\$next_workflow\/dispatches/
  );
});
