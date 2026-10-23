import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const filename = 'production-community-joint-runtime-control.yml';
const file = `../.github/workflows/${filename}`;
const workflow = readFileSync(new URL(file, import.meta.url), 'utf8');
const matches = (pattern) => assert.match(workflow, pattern);
const absent = (pattern) => assert.doesNotMatch(workflow, pattern);
const before = (first, second) =>
  assert.ok(workflow.indexOf(first) < workflow.indexOf(second));

test('joint activation needs a one-use OWNER approval', () => {
  matches(/on:\n  issue_comment:\n    types: \[created\]/);
  absent(/\n  (push|pull_request|workflow_dispatch):/);
  matches(/github\.event\.issue\.number == 2457/);
  matches(/github\.event\.issue\.pull_request != null/);
  matches(/github\.event\.comment\.author_association == 'OWNER'/);
  matches(/github\.event\.comment\.user\.login == 'bingohooah888-ai'/);
  matches(/NOVELIGHT_COMMUNITY_JOINT_RUNTIME_APPROVE /);
  matches(/\.mainSha\|type=="string"/);
  matches(/\.challenge\|type=="string"/);
  matches(/gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads\/main"/);
  matches(/NOVELIGHT_COMMUNITY_JOINT_RUNTIME_CLAIMED/);
});

test('enable checks paired flags, schemas, permissions and backup', () => {
  matches(/20261014052000/);
  matches(/20261023055617/);
  matches(/community_board_threads/);
  matches(/board_rls/);
  matches(/anon_raw_closed/);
  matches(/member_raw_closed/);
  matches(/read_only:true/);
  matches(/check-production-backup-freshness\.mjs/);
  matches(/timeline:\[\[:space:\]\]\*true/);
  matches(/board:\[\[:space:\]\]\*true/);
  const boardLineCheck =
    "grep -Eq '^[[:space:]]*board:[[:space:]]*true[[:space:]]*,?[[:space:]]*
  matches(/\.\[0\]\.enabled==false/);
  before('Read-only DB and release preflight', 'Claim approved action');
  before('Claim approved action', 'Change only the Production runtime gate');
});

test('disable is schema-independent and fail-closed', () => {
  matches(/Emergency stop must work even if the Phase 2 board schema/);
  matches(/SELECT public_enabled AS enabled/);
  matches(/singleton=true AND public_enabled=true RETURNING/);
  matches(/Emergency fail-closed after any claimed enable failure/);
  matches(/steps\.claim\.outcome == 'success'/);
  matches(/WHERE singleton=true\s*\n\s*RETURNING public_enabled/);
  matches(/NOVELIGHT_COMMUNITY_JOINT_RUNTIME_EXECUTED/);
  absent(/\b(DROP|TRUNCATE|DELETE FROM)\b/i);
});
";
  assert.ok(workflow.includes(boardLineCheck));
  matches(/\.\[0\]\.enabled==false/);
  before('Read-only DB and release preflight', 'Claim approved action');
  before('Claim approved action', 'Change only the Production runtime gate');
});

test('disable is schema-independent and fail-closed', () => {
  matches(/Emergency stop must work even if the Phase 2 board schema/);
  matches(/SELECT public_enabled AS enabled/);
  matches(/singleton=true AND public_enabled=true RETURNING/);
  matches(/Emergency fail-closed after any claimed enable failure/);
  matches(/steps\.claim\.outcome == 'success'/);
  matches(/WHERE singleton=true\s*\n\s*RETURNING public_enabled/);
  matches(/NOVELIGHT_COMMUNITY_JOINT_RUNTIME_EXECUTED/);
  absent(/\b(DROP|TRUNCATE|DELETE FROM)\b/i);
});
