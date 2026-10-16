import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';

const workflow = readFileSync(
  new URL(
    '../.github/workflows/community-candidate-preview.yml',
    import.meta.url
  ),
  'utf8'
);
const bypass = [
  'VERCEL_AUTOMATION_BYPASS_SECRET: $',
  '{{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}'
].join('');

test('bypass is checked before any Preview deployment cost', () => {
  const start = workflow.indexOf('Prove dedicated Staging');
  const end = workflow.indexOf('Recheck exact refs');
  const gate = workflow.slice(start, end);
  assert.ok(start > 0);
  assert.ok(end > start);
  assert.ok(gate.includes(bypass));
  assert.ok(gate.includes('test -n "$VERCEL_AUTOMATION_BYPASS_SECRET"'));
});

test('protected verification receives the same scoped bypass', () => {
  const start = workflow.indexOf('Verify Preview environment facts');
  const verify = workflow.slice(start);
  assert.ok(start > 0);
  assert.ok(verify.includes(bypass));
  assert.match(verify, /run: node scripts\/verify-staging-deployment\.mjs/u);

  const job = workflow.split('  preview:')[1];
  const header = job.split('    steps:')[0];
  assert.doesNotMatch(header, /VERCEL_AUTOMATION_BYPASS_SECRET/u);
  assert.doesNotMatch(workflow, /workflow_dispatch:/u);
});
