import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  '.github/workflows/staging-favorite-genres-reconcile-20261021.yml',
  'utf8'
);

function has(...patterns) {
  for (const pattern of patterns) {
    assert.match(workflow, pattern);
  }
}

test('OWNER-only one-use Staging approval', () => {
  has(
    /on:\n  issue_comment:\n    types: \[created\]/,
    /github\.event\.issue\.number == 294/,
    /github\.event\.comment\.author_association == 'OWNER'/,
    /NOVELIGHT_STAGING_FAVORITE_GENRES_APPROVE /,
    /staging-favorite-genres-reconcile-20261021/,
    /NOVELIGHT_STAGING_FAVORITE_GENRES_CLAIMED /,
    /NOVELIGHT_STAGING_FAVORITE_GENRES_CONSUMED /,
    /github\.event\.issue\.user\.login == 'bingohooah888-ai'/,
    /environment: staging/
  );
  assert.doesNotMatch(workflow, /workflow_dispatch:|push:|pull_request:/);
});

test('one favorite-genres migration on exact Staging', () => {
  has(
    /EXPECTED_MIGRATIONS: '20261018120000'/,
    /EXPECTED_PROJECT_REF: wmlzjgvxgoyrovdhbqbg/,
    /STAGING_SUPABASE_URL.*vars\.STAGING_SUPABASE_URL/,
    /PGSSLMODE: require/,
    /node scripts\/verify-staging-migration-target\.mjs/,
    /scripts\/verify-staging-migrations\.sh pending/,
    /20261018120000_profile_favorite_genres_precheck\.sql/,
    /20261018120000_profile_favorite_genres_postcheck\.sql/
  );
  assert.doesNotMatch(
    workflow,
    /NOVELIGHT_STAGING_AUTHOR_COVER_MIME|20261018090000/
  );
});

test('known Community migration with public gate OFF', () => {
  has(
    /git\/blobs\/1f5ef773a4073f10cc2e1b886eb3a8c942beb5c4/,
    /test "\$\(git hash-object "\$stagedir\/supabase\/migrations\/\$original"\)"/,
    /grep -Fxv '20261018120000' \/tmp\/favorite-local-migrations\.txt/,
    /grep -Fxc '20261014052000' \/tmp\/staging-validated-remote\.txt/,
    /diff -u \/tmp\/favorite-expected-remote\.txt/,
    /test "\$gate" = 'false\|0\|0\|0'/,
    /supabase db push --db-url "\$STAGING_DATABASE_URL" --dry-run/,
    /supabase db push --db-url "\$STAGING_DATABASE_URL" --yes/,
    /diff -u \/tmp\/staging-two-expected-applied\.txt/
  );
  assert.doesNotMatch(workflow, /migration repair|\breset\b/);
  assert.doesNotMatch(workflow, /public_enabled\s*=\s*true/);
});

test('rechecks main and always consumes or cleans up', () => {
  has(
    /git fetch --no-tags --depth=1 origin main/,
    /test "\$\(git rev-parse FETCH_HEAD\)" = "\$MAIN_SHA"/,
    /steps\.claim\.outcome == 'success'/,
    /steps\.apply_favorite\.outcome/,
    /if: always\(\)/,
    /rm -f "\$STAGING_DATABASE_URL_FILE"/,
    /STAGING_RECOVERY_REQUIRED/
  );
});
