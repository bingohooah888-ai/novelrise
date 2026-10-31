import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FOLLOW_LIST_PINNED,
  composePinnedFollowListStagingSql,
  gitBlobSha
} from '../scripts/staging-follow-list-pinned-sql.mjs';
import { unwrapCandidateSql } from '../scripts/staging-candidate-sql.mjs';

const root = 'tests/fixtures/follow-list-pinned/';
const artifacts = Object.fromEntries(
  Object.keys(FOLLOW_LIST_PINNED.blobs).map((kind) => [
    kind,
    readFileSync(root + kind + '.sql.txt', 'utf8')
  ])
);

const valid = () => ({
  pr: 2698,
  version: '20261031173000',
  migrationFile: '20261031173000_followed_authors_list.sql',
  artifacts
});

test('trusted snapshots match the four exact reviewed Git blob hashes', () => {
  for (const [kind, expected] of Object.entries(FOLLOW_LIST_PINNED.blobs)) {
    assert.equal(gitBlobSha(artifacts[kind]), expected);
  }
});

test('trusted compiler produces one bounded staging transaction', () => {
  const sql = composePinnedFollowListStagingSql(valid());
  assert.match(sql, /^\\set ON_ERROR_STOP on\nBEGIN;/u);
  assert.equal((sql.match(/^BEGIN;$/gmu) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;$/gmu) || []).length, 1);
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/u);
  assert.equal((sql.match(/security definer/gmu) || []).length, 3);
  assert.match(sql, /'20261031173000','followed_authors_list'/u);
  assert.match(sql, /novelight_follow_counts/u);
  assert.doesNotMatch(sql, /drop function public.novelight_followers/u);
  assert.match(sql, /STAGING|Staging/u);
});

test('wrong PR or migration and any modified source fail closed', () => {
  for (const field of ['pr', 'version', 'migrationFile']) {
    const bad = valid();
    bad[field] = 'not-pinned';
    assert.throws(
      () => composePinnedFollowListStagingSql(bad),
      /FOLLOW_LIST_PINNED_STAGING_DENIED/u
    );
  }
  for (const kind of Object.keys(FOLLOW_LIST_PINNED.blobs)) {
    const bad = valid();
    bad.artifacts = { ...artifacts, [kind]: artifacts[kind] + '\n-- drift' };
    assert.throws(
      () => composePinnedFollowListStagingSql(bad),
      new RegExp('reviewed Git blob mismatch: ' + kind)
    );
  }
  const extra = valid();
  extra.artifacts = { ...artifacts, unexpected: 'select 1' };
  assert.throws(() => composePinnedFollowListStagingSql(extra));
});

test('generic SQL filter still denies SECURITY DEFINER candidates', () => {
  assert.throws(
    () => unwrapCandidateSql(artifacts.migration, 'migration'),
    /STAGING_CANDIDATE_SQL_DENIED/u
  );
});

test('only the narrowly scoped workflow routes to this exception', () => {
  const workflow = readFileSync(
    '.github/workflows/staging-candidate-db-persistent-apply.yml',
    'utf8'
  );
  assert.match(workflow, /"\$PR_NUMBER" == '2698'/u);
  assert.match(workflow, /"\$MIGRATION" == '20261031173000'/u);
  assert.match(workflow, /staging-follow-list-pinned-sql\.mjs compose/u);
  assert.match(workflow, /staging-candidate-persist-sql\.mjs compose/u);
  assert.match(workflow, /novelight-staging-candidate-persist\.sql/u);
  assert.match(workflow, /NOVELIGHT_STAGING_CANDIDATE_PERSIST_APPROVE/u);
});
