import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const filename = '../.github/workflows/ai-gatea-staging-independent-stop-once.yml';
const workflow = readFileSync(new URL(filename, import.meta.url), 'utf8');

test('trusted Staging failure uses existing isolated STOP', () => {
  const required = [
    'issue_comment:',
    'workflow_run:',
    "github.event_name == 'issue_comment'",
    "github.event_name == 'workflow_run'",
    "github.event.comment.author_association == 'OWNER'",
    "github.event.workflow_run.conclusion == 'failure'",
    "github.event.workflow_run.conclusion == 'timed_out'",
    "github.event.workflow_run.head_branch == 'main'",
    'ai-020705-staging-protected-entry.yml',
    'GATEA_STAGING_ALREADY_OFF_ZERO_PASS',
    'GATEA_STAGING_TARGET_OR_CREDENTIAL_NO_GO',
    'secrets.GATEA_STAGING_STOP_DATABASE_URL',
    'ref: ${{ github.sha }}'
  ];
  for (const marker of required) {
    assert.ok(workflow.includes(marker), marker);
  }
  const stop = 'SELECT gatea_stop_private.stop_once();';
  assert.equal(workflow.split(stop).length, 2);
});

test('this fallback never opens paid admission or deploys Cloudflare', () => {
  assert.ok(workflow.includes('NOT Cloudflare heartbeat death'));
  assert.ok(!workflow.includes('workflow_dispatch:'));
  assert.ok(!workflow.includes('wrangler deploy'));
});
