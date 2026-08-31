import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readLocalMigrationVersions,
  resolveStagingProjectRef,
  verifyStagingMigrationParity
} from '../scripts/verify-staging-migration-parity.mjs';

const stagingUrl = 'https://abcdefghijklmnopqrst.supabase.co';

function responseFor(versions) {
  return {
    ok: true,
    status: 201,
    async json() {
      return versions.map((version) => ({ version }));
    }
  };
}

test('Staging migration verifier refuses the Production Supabase project', () => {
  assert.throws(
    () => resolveStagingProjectRef('https://fiepaguycecrredwrcwx.supabase.co'),
    /refusing the Production Supabase project/
  );
});

test('Staging migration verifier performs a read-only Management API query and accepts exact parity', async () => {
  const localVersions = await readLocalMigrationVersions();
  let observedUrl;
  let observedRequest;

  const result = await verifyStagingMigrationParity(
    {
      STAGING_SUPABASE_URL: stagingUrl,
      SUPABASE_ACCESS_TOKEN: 'test-access-token'
    },
    {
      fetchImpl: async (url, request) => {
        observedUrl = url;
        observedRequest = request;
        return responseFor(localVersions);
      }
    }
  );

  assert.equal(result.projectRef, 'abcdefghijklmnopqrst');
  assert.deepEqual(result.versions, localVersions);
  assert.equal(
    observedUrl,
    'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query'
  );
  assert.equal(observedRequest.method, 'POST');
  const body = JSON.parse(observedRequest.body);
  assert.equal(body.read_only, true);
  assert.match(body.query, /supabase_migrations\.schema_migrations/);
});

test('Staging migration verifier fails closed when a repository migration is missing remotely', async () => {
  const localVersions = await readLocalMigrationVersions();
  const missingVersion = localVersions.at(-1);

  await assert.rejects(
    verifyStagingMigrationParity(
      {
        STAGING_SUPABASE_URL: stagingUrl,
        SUPABASE_ACCESS_TOKEN: 'test-access-token'
      },
      {
        fetchImpl: async () => responseFor(localVersions.slice(0, -1))
      }
    ),
    new RegExp(`missing on Staging: ${missingVersion}`)
  );
});

test('Staging migration verifier fails closed on unexpected remote migration history', async () => {
  const localVersions = await readLocalMigrationVersions();

  await assert.rejects(
    verifyStagingMigrationParity(
      {
        STAGING_SUPABASE_URL: stagingUrl,
        SUPABASE_ACCESS_TOKEN: 'test-access-token'
      },
      {
        fetchImpl: async () =>
          responseFor([...localVersions, '20991231235959'].sort())
      }
    ),
    /unexpected on Staging: 20991231235959/
  );
});

test('Staging migration verifier does not log an access token when the API rejects the query', async () => {
  await assert.rejects(
    verifyStagingMigrationParity(
      {
        STAGING_SUPABASE_URL: stagingUrl,
        SUPABASE_ACCESS_TOKEN: 'sensitive-token-value'
      },
      {
        fetchImpl: async () => ({
          ok: false,
          status: 403,
          async json() {
            return { message: 'denied' };
          }
        })
      }
    ),
    (error) => {
      assert.match(error.message, /HTTP 403/);
      assert.doesNotMatch(error.message, /sensitive-token-value/);
      return true;
    }
  );
});
