import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  compileCampaignStagingTransaction,
  EXPECTED_BLOBS,
  FIXED_FILES
} from '../scripts/compose-scout-campaign-staging.mjs';

const parts = Object.fromEntries(
  Object.entries(FIXED_FILES).map(([key, path]) => [
    key,
    readFileSync(path, 'utf8')
  ])
);

test('one-shot staging compiler accepts only exactly reviewed SQL artifacts', () => {
  const sql = compileCampaignStagingTransaction(parts);
  assert.match(sql, /BEGIN;/u);
  assert.match(sql, /COMMIT;/u);
  assert.match(sql, /20261029142000/u);
  assert.match(sql, /fcf216ef3062983bea13ff4143b92f53/u);
  assert.match(sql, /4d52acf3a1d5f52db73456357a39d5fc/u);
  assert.match(sql, /STAGING_AUTH_USERS_TRIGGER_MD5/u);
  assert.equal(Object.keys(EXPECTED_BLOBS).length, 4);
  assert.throws(
    () =>
      compileCampaignStagingTransaction({
        ...parts,
        migration: parts.migration + '\nselect 1;'
      }),
    /CAMPAIGN_STAGING_TRANSACTION_DENIED/u
  );
});

const yaml = readFileSync(
  '.github/workflows/staging-scout-campaign-exclusion-once.yml',
  'utf8'
);

test('staging writer is OWNER only, one-use, Staging-only and SHA bound', () => {
  assert.match(yaml, /author_association == 'OWNER'/u);
  assert.match(yaml, /environment: staging/u);
  assert.match(
    yaml,
    /STAGING_DATABASE_URL_SOURCE:.*secrets.STAGING_DATABASE_URL/u
  );
  assert.match(yaml, /SCOUT_CAMPAIGN_STAGING_MIGRATION_PASS/u);
  assert.match(yaml, /NOVELIGHT_STAGING_CAMPAIGN_EXCLUSION_CONSUMED/u);
  assert.doesNotMatch(yaml, /workflow_dispatch:/u);
});
