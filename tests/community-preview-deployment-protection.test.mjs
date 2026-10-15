import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';

const workflow = readFileSync(
  new URL('../.github/workflows/community-candidate-preview.yml', import.meta.url),
  'utf8'
);
const bypassBinding =
  'VERCEL_AUTOMATION_BYPASS_SECRET: $' + '{{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}';

test('Preview cannot spend build capacity without a configured bypass', () => {
  const check = workflow.split(
    '      - name: Prove dedicated Staging is gated OFF before Preview exists'
  )[1].split('      - name: Recheck exact refs immediately before cost-bearing creation')[0];
  assert.ok(check.includes(bypassBinding));
  assert.ok(check.includes('test -n "$VERCEL_AUTOMATION_BYPASS_SECRET"'));
});

test('protected environment fact check receives only the existing bypass', () => {
  const verify = workflow.split(
    '      - name: Verify Preview environment facts before browser access'
  )[1].split('  consume:')[0];
  assert.ok(verify.includes(bypassBinding));
  assert.match(verify, /run: node scripts\/verify-staging-deployment\.mjs/u);
  assert.doesNotMatch(workflow.split('  preview:')[1].split('    steps:')[0], /VERCEL_AUTOMATION_BYPASS_SECRET/u);
  assert.doesNotMatch(workflow, /workflow_dispatch:/u);
});
