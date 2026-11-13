import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const source = readFileSync(
  new URL(
    '../.github/workflows/staging-reader-point-tenfold-proof.yml',
    import.meta.url
  ),
  'utf8'
);
const before = (a, b) => {
  const x = source.indexOf(a),
    y = source.indexOf(b);
  assert.ok(x >= 0, 'missing ' + a);
  assert.ok(y >= 0, 'missing ' + b);
  assert.ok(x < y, a + ' must precede ' + b);
};
test('workflow only starts from a created GitHub Issue comment', () => {
  assert.match(source, /\non:\n  issue_comment:\n    types: \[created\]/u);
  assert.doesNotMatch(
    source,
    /^\s+(push|pull_request|workflow_dispatch|schedule):/mu
  );
});
test('workload is bound to Issue #294, its owner and exact title', () => {
  for (const phrase of [
    'github.event.issue.number == 294',
    "github.event.issue.state == 'open'",
    "github.event.issue.title == '[Staging Control] Supabase migration sync'",
    "github.event.issue.user.login == 'bingohooah888-ai'"
  ]) {
    assert.ok(source.includes(phrase), phrase);
  }
});
test('actor, triggerer, author and GitHub association must all be OWNER', () => {
  for (const field of [
    "github.event.comment.user.login == 'bingohooah888-ai'",
    "github.event.comment.author_association == 'OWNER'",
    "github.actor == 'bingohooah888-ai'",
    "github.triggering_actor == 'bingohooah888-ai'"
  ])
    assert.ok(source.includes(field), field);
});
test('scope has isolated prefix and never reuses existing migration approval', () => {
  assert.match(source, /NOVELIGHT_STAGING_READER_POINT10X_APPROVE /u);
  assert.doesNotMatch(
    source,
    /startsWith\(github.event.comment.body, 'NOVELIGHT_STAGING_APPROVE /u
  );
});
test('trusted code always checked out from main not untrusted PR', () => {
  assert.match(source, /ref: main/u);
  assert.match(source, /ref: \$\{\{ needs\.admit\.outputs\.main_sha \}\}/u);
  assert.doesNotMatch(
    source,
    /ref: \$\{\{ needs\.admit\.outputs\.candidate_sha \}\}/u
  );
});
test('no persistent Staging mutation or Production connection target is present', () => {
  assert.match(source, /rollback-only/u);
  assert.match(source, /STAGING_POINT10X_ROLLBACK_ONLY_PASS/u);
  assert.doesNotMatch(
    source,
    /supabase db push|supabase db reset|--yes --db-url|pg_dump.*fiepaguycecrredwrcwx/u
  );
});
test('admission ledger serialized and claim occurs before stage', () => {
  assert.match(source, /group: novelight-reader-point10x-admit-issue294/u);
  before(
    'CLAIM once before Staging secrets can be accessed',
    'Isolated backup restore, then one rollback-only Staging SQL proof'
  );
});
test('shared staging lock is preserved', () => {
  assert.match(source, /group: supabase-staging-migration-sync/u);
  assert.match(source, /cancel-in-progress: false/u);
});
test('current staging project is exact and hardcoded', () => {
  assert.match(source, /https:\/\/wmlzjgvxgoyrovdhbqbg\.supabase\.co/u);
  assert.match(source, /test "\$STAGING_SUPABASE_URL"/u);
});
test('dedicated target validator remains mandatory', () => {
  assert.match(source, /scripts\/verify-staging-migration-target\.mjs/u);
  assert.match(source, /PGSSLMODE: require/u);
});
test('candidate file content is Git blob SHA pinned', () => {
  assert.match(source, /git hash-object/u);
  assert.match(source, /jq -e --arg pin "\$blob"/u);
  assert.match(source, /never candidate code/u);
});
test('trusted composer produces one rollback-only SQL transaction', () => {
  assert.match(source, /scripts\/staging-candidate-sql\.mjs compose/u);
  assert.match(source, /approved-rollback-only\.sql/u);
});
test('backup exists and is validated before the rollback SQL could execute', () => {
  before(
    'Verify full logical Staging backup and independent restore BEFORE any Staging write',
    'Check exact refs again and execute one ROLLBACK-ONLY Staging transaction'
  );
});
test('logical pg_dump cannot be skipped and is never uploaded as artifact', () => {
  assert.match(source, /pg_dump "\$STAGING_DATABASE_URL" --format=custom/u);
  assert.match(source, /pg_restore --exit-on-error/u);
  assert.doesNotMatch(source, /upload-artifact|actions\/cache/u);
});
test('restoration uses disposable Postgres17 service, not the Staging target', () => {
  assert.match(source, /image: postgres:17/u);
  assert.match(source, /--host 127\.0\.0\.1/u);
  assert.match(source, /--dbname point10x_restore/u);
});
test('restored data checked against live Staging before any transaction', () => {
  assert.match(
    source,
    /diff -u \/tmp\/point10x-staging-before-summary \/tmp\/point10x-restore-ledger-summary/u
  );
});
test('Staging refs rechecked immediately before SQL rollback-only proof', () => {
  assert.ok(
    source.lastIndexOf(
      'test "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq'
    ) >
      source.indexOf(
        'Check exact refs again and execute one ROLLBACK-ONLY Staging transaction'
      )
  );
});
test('postrollback stage ledger is compared against pre-state', () => {
  assert.match(
    source,
    /diff -u \/tmp\/point10x-staging-before-summary \/tmp\/point10x-staging-after-summary/u
  );
});
test('run always cleans up secrets, backup and temporary SQL', () => {
  assert.match(
    source,
    /Remove all ephemeral database credentials, SQL, backups and local snapshots/u
  );
  assert.match(source, /if: always\(\)/u);
  assert.match(source, /novelight-point10x-private-staging\.dump/u);
});
test('record job consumes request on all completion statuses', () => {
  assert.match(source, /needs: \[admit, stage\]/u);
  assert.match(source, /if: always\(\) && needs\.admit\.result == 'success'/u);
  assert.match(source, /success\|failure\|cancelled\|skipped/u);
  assert.match(source, /NOVELIGHT_STAGING_READER_POINT10X_CONSUMED/u);
});
test('Stage isolated environment and no privileged login before admission', () => {
  before(
    'CLAIM once before Staging secrets can be accessed',
    'environment: staging'
  );
  assert.match(source, /needs: admit/u);
});
