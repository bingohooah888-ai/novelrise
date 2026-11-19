import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(
  new URL(
    '../.github/workflows/production-migration-approved-dispatch.yml',
    import.meta.url
  ),
  'utf8'
);
const isolationStep =
  '      - name: Isolate Staging-only AI migration for approved reply-history release';
const pendingStep =
  '      - name: Require approved pending migrations at Production boundary';
const postcheckStep =
  '      - name: Verify production migration status after deploy';

test('reply-history exception is pinned and fails closed before all-migrations push', () => {
  const isolationAt = workflow.indexOf(isolationStep);
  const pendingAt = workflow.indexOf(pendingStep);
  const dryRunAt = workflow.indexOf(
    'run: supabase db push --linked --dry-run --include-all'
  );
  const applyAt = workflow.indexOf(
    'run: supabase db push --linked --yes --include-all'
  );
  const postcheckAt = workflow.indexOf(postcheckStep);

  assert.ok(isolationAt >= 0);
  assert.ok(isolationAt < pendingAt);
  assert.ok(pendingAt < dryRunAt);
  assert.ok(dryRunAt < applyAt);
  assert.ok(applyAt < postcheckAt);

  const isolation = workflow.slice(isolationAt, pendingAt);
  const exactScope = `if: env.APPROVED_MIGRATIONS == '20261118221000'`;
  assert.equal(workflow.split(exactScope).length - 1, 1);
  assert.ok(isolation.includes(exactScope));
  assert.ok(
    isolation.includes(
      "staging_only='supabase/migrations/20261101060000_novelight_ai_020705_one_shot_claim.sql'"
    )
  );
  assert.ok(
    isolation.includes(
      "pinned_blob='8f9e81effe7f2a116460ea8538aea553d1775cc0'"
    )
  );
  assert.ok(isolation.includes('git hash-object "$staging_only"'));
  assert.ok(
    isolation.includes(
      "printf '%s\\n' '20261101060000' '20261118221000'"
    )
  );
  assert.ok(
    isolation.includes(
      'diff -u /tmp/reply-history-expected.txt /tmp/reply-history-pending.txt'
    )
  );
  assert.ok(isolation.includes('mv -- "$staging_only" "$isolated"'));
});

test('postcheck restores the AI migration and leaves it unapplied', () => {
  const postcheckAt = workflow.indexOf(postcheckStep);
  assert.ok(postcheckAt >= 0);
  const postcheck = workflow.slice(postcheckAt);
  assert.ok(
    postcheck.includes(
      `if [ "$APPROVED_MIGRATIONS" = '20261118221000' ]; then`
    )
  );
  assert.ok(postcheck.includes('mv -- "$isolated" "$staging_only"'));
  assert.ok(
    postcheck.includes(
      "test \"$(git hash-object \"$staging_only\")\" = '8f9e81effe7f2a116460ea8538aea553d1775cc0'"
    )
  );
  assert.ok(postcheck.includes("expected_pending='20261101060000'"));
  assert.ok(
    postcheck.includes(
      'if [ "$pending_migrations" != "$expected_pending" ]; then'
    )
  );
});
