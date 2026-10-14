// Regression: unrelated issue_comment workflows must not enter the shared Staging lock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ownerStagingJobs = [
  ['community-staging-candidate-transaction.yml', 'transaction'],
  ['supabase-staging-sync.yml', 'sync'],
  ['staging-search-card-history-reconcile.yml', 'reconcile'],
  ['staging-backlog-recovery.yml', 'recover'],
  ['staging-rls-parity.yml', 'parity']
];

for (const [workflow, job] of ownerStagingJobs) {
  test(`Staging lock is job-scoped and queued: ${workflow}`, () => {
    const yaml = readFileSync(
      new URL(`../.github/workflows/${workflow}`, import.meta.url),
      'utf8'
    );
    assert.doesNotMatch(yaml, /^concurrency:/mu);
    assert.ok(yaml.includes(
      `  ${job}:\n    concurrency:\n      group: supabase-staging-migration-sync\n      cancel-in-progress: false\n      queue: max`
    ));
  });
}

test('Issue-comment Staging entry points retain OWNER and exact-prefix guards', () => {
  for (const workflow of ownerStagingJobs.map(([name]) => name)
    .filter((name) => name !== 'supabase-staging-sync.yml')) {
    const yaml = readFileSync(
      new URL(`../.github/workflows/${workflow}`, import.meta.url),
      'utf8'
    );
    assert.match(yaml, /github\.event\.comment\.author_association == 'OWNER'/u);
    assert.match(yaml, /startsWith\(github\.event\.comment\.body,/u);
  }
});
