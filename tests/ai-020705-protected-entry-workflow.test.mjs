import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// prettier-ignore
const yaml = readFileSync(
  new URL('../.github/workflows/ai-020705-staging-protected-entry.yml', import.meta.url),
  'utf8'
);

// prettier-ignore
test('protected admission requires Issue 294 OWNER intent and trusted main', () => {
  assert.match(yaml, /issue_comment:/u);
  assert.match(yaml, /environment: staging/u);
  assert.match(yaml, /github.event.issue.number == 294/u);
  assert.match(yaml, /github.event.comment.author_association == 'OWNER'/u);
  assert.match(yaml, /NOVELIGHT_STAGING_AI_020705_INTEGRATION_INTENT/u);
  assert.match(yaml, /\.base\.sha == \$main and \.head\.sha == \$head/u);
  assert.match(yaml, /no Staging mutation or paid authorization/u);
});

// prettier-ignore
test('new protected entry cannot run live work from PR or secret by itself', () => {
  assert.doesNotMatch(yaml, /workflow_dispatch:/u);
  assert.doesNotMatch(yaml, /pull_request:/u);
  assert.doesNotMatch(yaml, /secrets\./u);
  assert.doesNotMatch(yaml, /STAGING_DATABASE_URL|OPENAI_API_KEY/u);
  assert.doesNotMatch(yaml, /node .*staging-live-/u);
  assert.doesNotMatch(yaml, /node .*protected-live-composition/u);
  assert.match(yaml, /AI_020705_LIVE_NO_GO/u);
  assert.match(yaml, /persist-credentials: false/u);
});
