import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  '.github/workflows/staging-favorite-genres-reconcile-20261021.yml',
  'utf8'
);

test('favorite genres Staging reconciliation requires OWNER-only one-use consent', () => {
  assert.match(workflow, /on:\n  issue_comment:\n    types: \[created\]/);
  assert.match(workflow, /github\.event\.issue\.number == 294/);
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(workflow, /NOVELIGHT_STAGING_FAVORITE_GENRES_APPROVE /);
  assert.match(workflow, /staging-favorite-genres-reconcile-20261021/);
  assert.match(workflow, /NOVELIGHT_STAGING_FAVORITE_GENRES_CLAIMED /);
  assert.match(workflow, /NOVELIGHT_STAGING_FAVORITE_GENRES_CONSUMED /);
  assert.match(workflow, /github\.event\.issue\.user\.login == 'bingohooah888-ai'/);
  assert.match(workflow, /environment: staging/);
  assert.doesNotMatch(workflow, /workflow_dispatch:|push:|pull_request:/);
});

test('targets only existing SSL Staging and one missing approved main migration', () => {
  assert.match(workflow, /EXPECTED_MIGRATIONS: '20261018120000'/);
  assert.match(workflow, /EXPECTED_PROJECT_REF: wmlzjgvxgoyrovdhbqbg/);
  assert.match(workflow, /STAGING_SUPABASE_URL.*vars\.STAGING_SUPABASE_URL/);
  assert.match(workflow, /PGSSLMODE: require/);
  assert.match(workflow, /node scripts\/verify-staging-migration-target\.mjs/);
  assert.match(workflow, /scripts\/verify-staging-migrations\.sh pending/);
  assert.match(workflow, /20261018120000_profile_favorite_genres_precheck\.sql/);
  assert.match(workflow, /20261018120000_profile_favorite_genres_postcheck\.sql/);
  assert.doesNotMatch(workflow, /NOVELIGHT_STAGING_AUTHOR_COVER_MIME|20261018090000/);
});

test('keeps exact known community-only migration, refuses unknown drift and public activation', () => {
  assert.match(workflow, /git\/blobs\/1f5ef773a4073f10cc2e1b886eb3a8c942beb5c4/);
  assert.match(workflow, /test "\$\(git hash-object "\$stagedir\/supabase\/migrations\/\$original"\)"/);
  assert.match(workflow, /grep -Fxv '20261018120000' \/tmp\/favorite-local-migrations\.txt/);
  assert.match(workflow, /grep -Fxc '20261014052000' \/tmp\/staging-validated-remote\.txt/);
  assert.match(workflow, /diff -u \/tmp\/favorite-expected-remote\.txt \/tmp\/staging-validated-remote\.txt/);
  assert.match(workflow, /test "\$gate" = 'false\|0\|0\|0'/);
  assert.match(workflow, /supabase db push --db-url "\$STAGING_DATABASE_URL" --dry-run/);
  assert.match(workflow, /supabase db push --db-url "\$STAGING_DATABASE_URL" --yes/);
  assert.match(workflow, /diff -u \/tmp\/staging-two-expected-applied\.txt/);
  assert.doesNotMatch(workflow, /migration repair|\breset\b|public_enabled\s*=\s*true/);
});

test('preserves immutable main and consumed-failure boundary', () => {
  assert.match(workflow, /git fetch --no-tags --depth=1 origin main/);
  assert.match(workflow, /test "\$\(git rev-parse FETCH_HEAD\)" = "\$MAIN_SHA"/);
  assert.match(workflow, /steps\.claim\.outcome == 'success'/);
  assert.match(workflow, /steps\.apply_favorite\.outcome/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /rm -f "\$STAGING_DATABASE_URL_FILE"/);
  assert.match(workflow, /STAGING_RECOVERY_REQUIRED/);
});
