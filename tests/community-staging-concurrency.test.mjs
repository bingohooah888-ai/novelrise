// Regression: unrelated events must not occupy the shared Staging mutex.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';

const ownerStagingJobs = [
  ['community-staging-candidate-transaction.yml', 'transaction'],
  ['supabase-staging-sync.yml', 'sync'],
  ['staging-search-card-history-reconcile.yml', 'reconcile'],
  ['staging-backlog-recovery.yml', 'recover'],
  ['staging-rls-parity.yml', 'parity']
];

for (const [workflow, job] of ownerStagingJobs) {
  test(`Job-only Staging mutex: ${workflow}`, () => {
    const yaml = readFileSync(
      new URL(`../.github/workflows/${workflow}`, import.meta.url),
      'utf8'
    );
    const mutex = [
      `  ${job}:`,
      '    concurrency:',
      '      group: supabase-staging-migration-sync',
      '      cancel-in-progress: false'
    ].join('\n');
    assert.doesNotMatch(yaml, /^concurrency:/mu);
    assert.ok(yaml.includes(mutex));
  });
}

test('OWNER and event-prefix admission guards remain enabled', () => {
  for (const [workflow] of ownerStagingJobs) {
    if (workflow === 'supabase-staging-sync.yml') continue;
    const yaml = readFileSync(
      new URL(`../.github/workflows/${workflow}`, import.meta.url),
      'utf8'
    );
    const owner = /github\.event\.comment\.author_association == 'OWNER'/u;
    assert.match(yaml, owner);
    assert.match(yaml, /startsWith\(github\.event\.comment\.body,/u);
  }
});
