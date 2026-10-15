import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const awards = readFileSync(
  new URL('../scripts/november-contest-final-award-readonly-preview.sql',
    import.meta.url), 'utf8'
);
const start = readFileSync(
  new URL('../scripts/november-contest-start-plan.mjs', import.meta.url),
  'utf8'
);
const release = readFileSync(
  new URL('../scripts/november-contest-start-release.mjs', import.meta.url),
  'utf8'
);
const reader = readFileSync(
  new URL('../api/november-contest-read.js', import.meta.url), 'utf8'
);
const workflow = readFileSync(
  new URL('../.github/workflows/november-contest-start-approved-release.yml',
    import.meta.url), 'utf8'
);

test('final 1pt+ awards are rank-based across ALL entries, never interim top 10', () => {
  assert.match(awards, /rank\(\) OVER/);
  assert.match(awards, /r\.points >= 1/);
  assert.match(awards, /r\.final_rank <= c\.award_rank_limit/);
  assert.match(awards, /episode_points\(chapters,body_chars\)/);
  assert.match(awards, /ev\.body_char_count >= 200/);
  assert.match(awards, /reader\.review_status IN \('provisional','cleared'\)/);
  assert.match(awards, /NOT \(reader\.kind = 'account'/);
  assert.match(awards, /review_status = 'review_hold'/);
  assert.match(awards, /ends_at <= pg_catalog\.clock_timestamp\(\)/);
  assert.doesNotMatch(awards, /\bLIMIT\s+10\b|position\s*<=\s*10|row_number\(\)/i);
  assert.doesNotMatch(awards, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\s+(?:INTO\s+|FROM\s+)?(?:public\.)?novelight_contest_/i);
});

test('11/1 workflow is distinct from registration and cannot bypass production gate', () => {
  assert.match(workflow, /issue_comment:/);
  assert.match(workflow, /github\.event\.issue\.number == 2120/);
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(workflow, /NOVELIGHT_CONTEST_START_APPROVE/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /OWNER_APPROVED_START_ONLY/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(start, /CHAT_CONTEST_START_APPROVED/);
  assert.match(start, /status='active'/);
  assert.match(start, /registration_open/);
  assert.match(start, /STEP12_START_BLOCKED/);
  assert.match(release, /NOVELIGHT_CONTEST_START_CLAIMED/);
  assert.match(release, /NOVELIGHT_CONTEST_START_FAILED/);
  assert.match(release, /manualReconciliationRequired: true/);
});

test('reader is separately gated by a private env flag and strong signing secret', () => {
  assert.match(reader, /NOVELIGHT_CONTEST_READING_ENABLED/);
  assert.match(reader, /NOVELIGHT_CONTEST_GUEST_SIGNING_SECRET/);
  assert.match(reader, /Buffer\.byteLength\(secret, 'utf8'\) >= 32/);
  assert.match(reader, /secret !== process\.env\.SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(start, /NOVELIGHT_CONTEST_READING_ENABLED\s*=\s*true/);
});
