import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveStagingSupabaseOrigin,
  verifyStagingSchemaCapabilities
} from '../scripts/verify-staging-schema-capabilities.mjs';

const STAGING_URL = 'https://abcdefghijklmnopqrst.supabase.co';

function headers(allow = 'OPTIONS,POST') {
  return {
    get(name) {
      return name.toLowerCase() === 'allow' ? allow : null;
    }
  };
}

test('Staging schema capability verifier refuses the Production Supabase project', () => {
  assert.throws(
    () =>
      resolveStagingSupabaseOrigin(
        'https://fiepaguycecrredwrcwx.supabase.co'
      ),
    /refusing the Production Supabase project/
  );
});

test('Staging schema capability verifier proves required Checkout RPCs with OPTIONS only', async () => {
  const calls = [];
  const result = await verifyStagingSchemaCapabilities(
    {
      STAGING_SUPABASE_URL: STAGING_URL,
      STAGING_SUPABASE_SECRET_KEY: 'server-secret'
    },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, status: 200, headers: headers() };
      }
    }
  );

  assert.equal(result.projectRef, 'abcdefghijklmnopqrst');
  assert.deepEqual(result.rpcs, [
    'novelight_reserve_checkout_attempt',
    'novelight_attach_checkout_session',
    'novelight_release_checkout_attempt'
  ]);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ options }) => options.method === 'OPTIONS'));
  assert.ok(
    calls.every(({ options }) => options.headers.apikey === 'server-secret')
  );
  assert.ok(
    calls.every(
      ({ options }) => options.headers.Authorization === 'Bearer server-secret'
    )
  );
});

test('Staging schema capability verifier fails closed when a required RPC is missing', async () => {
  let count = 0;
  await assert.rejects(
    verifyStagingSchemaCapabilities(
      {
        STAGING_SUPABASE_URL: STAGING_URL,
        STAGING_SUPABASE_SECRET_KEY: 'server-secret'
      },
      {
        fetchImpl: async () => {
          count += 1;
          if (count === 2) {
            return { ok: false, status: 404, headers: headers('') };
          }
          return { ok: true, status: 200, headers: headers() };
        }
      }
    ),
    /required Staging RPC novelight_attach_checkout_session is unavailable/
  );
});

test('Staging schema capability verifier rejects an RPC route without POST support', async () => {
  await assert.rejects(
    verifyStagingSchemaCapabilities(
      {
        STAGING_SUPABASE_URL: STAGING_URL,
        STAGING_SUPABASE_SECRET_KEY: 'server-secret'
      },
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: headers('OPTIONS,GET,HEAD')
        })
      }
    ),
    /is not exposed as a callable RPC/
  );
});
