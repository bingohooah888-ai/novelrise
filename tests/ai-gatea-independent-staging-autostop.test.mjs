import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const workflow = readFileSync(
  new URL(
    '../.github/workflows/ai-gatea-staging-independent-stop-once.yml',
    import.meta.url
  ),
  'utf8'
);

test('manual OWNER STOP and trusted Staging failure share one STOP-only path', () => {
  assert.match(workflow, /issue_comment:\s+types: \[created\]/u);
  assert.match(workflow, /workflow_run:\s+workflows:/u);
  assert.match(workflow, /github\.event_name == 'issue_comment'/u);
  assert.match(workflow, /github\.event_name == 'workflow_run'/u);
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/u);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'failure'/u);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'timed_out'/u);
  assert.match(workflow, /workflow_run\.head_branch == 'main'/u);
  assert.match(workflow, /workflow_run\.head_repository\.full_name == 'bingohooah888-ai\/novelrise'/u);
  assert.match(workflow, /actions\/workflows\/ai-020705-staging-protected-entry\.yml/u);
  assert.match(workflow, /GITHUB_EVENT_NAME" = 'workflow_run'/u);
  assert.match(workflow, /GATEA_STAGING_ALREADY_OFF_ZERO_PASS/u);
  assert.match(workflow, /GATEA_STAGING_TARGET_OR_CREDENTIAL_NO_GO/u);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/u);
  assert.equal(
    (workflow.match(/SELECT gatea_stop_private\.stop_once\(\);/gu) || []).length,
    1
  );
  assert.equal(
    (workflow.match(/secrets\.GATEA_STAGING_STOP_DATABASE_URL/gu) || [])
      .length,
    1
  );
});

test('failed admission does not mean independent watchdog failure proof', () => {
  assert.match(workflow, /NOT Cloudflare heartbeat death/u);
  assert.doesNotMatch(workflow, /on:\s+schedule:/u);
  assert.doesNotMatch(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /wrangler deploy/u);
});
