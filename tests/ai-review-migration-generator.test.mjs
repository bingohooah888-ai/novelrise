import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('AI migration generator only creates a review candidate', () => {
  const script = readFileSync('scripts/prepare-ai-review-migration.sh', 'utf8');
  assert.match(script, /supabase migration new ai_review_candidates/);
  assert.match(
    script,
    /reports\/sql\/novelight_ai_review_candidates_PROPOSAL\.sql/
  );
  assert.match(script, /STOP: Do not merge, apply or sync/);
  assert.doesNotMatch(script, /supabase (?:db push|migration up|migration repair)/);
  assert.doesNotMatch(script, /supabase db reset/);
});
