import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const workflow = readFileSync(
  new URL('../.github/workflows/production-community-joint-runtime-control.yml', import.meta.url),
  'utf8'
);

test('joint public activation needs a one-use OWNER-approved PR comment', () => {
  assert.match(workflow, /on:\n  issue_comment:\n    types: \[created\]/);
  assert.doesNotMatch(workflow, /\n  (push|pull_request|workflow_dispatch):/);
  assert.match(workflow, /github\.event\.issue\.number == 2457/);
  assert.match(workflow, /github\.event\.issue\.pull_request != null/);
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(workflow, /github\.event\.comment\.user\.login == 'bingohooah888-ai'/);
  assert.match(workflow, /NOVELIGHT_COMMUNITY_JOINT_RUNTIME_APPROVE /);
  assert.match(workflow, /\.mainSha\|type=="string"/);
  assert.match(workflow, /\.challenge\|type=="string"/);
  assert.match(workflow, /gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads\/main"/);
  assert.match(workflow, /NOVELIGHT_COMMUNITY_JOINT_RUNTIME_CLAIMED/);
});

test('enabling requires deployed paired flags, both schemas, read-only checks and backup', () => {
  assert.match(workflow, /20261014052000/);
  assert.match(workflow, /20261023055617/);
  assert.match(workflow, /community_board_threads/);
  assert.match(workflow, /board_rls/);
  assert.match(workflow, /anon_raw_closed/);
  assert.match(workflow, /member_raw_closed/);
  assert.match(workflow, /read_only:true/);
  assert.match(workflow, /check-production-backup-freshness\.mjs/);
  assert.match(workflow, /timeline:\[\[:space:\]\]\*true/);
  assert.match(workflow, /board:\[\[:space:\]\]\*true/);
  assert.match(workflow, /\.\[0\]\.enabled==false/);
  assert.ok(workflow.indexOf('Read-only DB and release preflight') < workflow.indexOf('Claim approved action before mutation'));
  assert.ok(workflow.indexOf('Claim approved action before mutation') < workflow.indexOf('Change only the Production runtime gate'));
});

test('disable remains available if Phase2 schema is damaged; postcheck failure stops public access', () => {
  assert.match(workflow, /Emergency stop must work even if the Phase 2 board schema is damaged/);
  assert.match(workflow, /SELECT public_enabled AS enabled/);
  assert.match(workflow, /WHERE singleton=true AND public_enabled=true RETURNING public_enabled/);
  assert.match(workflow, /Emergency fail-closed after any claimed enable failure/);
  assert.match(workflow, /steps\.claim\.outcome == 'success'/);
  assert.match(workflow, /WHERE singleton=true\s*\n\s*RETURNING public_enabled/);
  assert.match(workflow, /NOVELIGHT_COMMUNITY_JOINT_RUNTIME_EXECUTED/);
  assert.doesNotMatch(workflow, /\b(DROP|TRUNCATE|DELETE FROM)\b/i);
});
