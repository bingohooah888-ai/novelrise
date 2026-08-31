import { pathToFileURL } from 'node:url';

const PRODUCTION_SUPABASE_REF = 'fiepaguycecrredwrcwx';
const REQUIRED_RPCS = [
  'novelight_reserve_checkout_attempt',
  'novelight_attach_checkout_session',
  'novelight_release_checkout_attempt'
];

function fail(message) {
  const error = new Error(`SCHEMA_DRIFT: ${message}`);
  error.category = 'SCHEMA_DRIFT';
  throw error;
}

export function resolveStagingSupabaseOrigin(value) {
  if (!value) fail('Staging Supabase URL is not configured.');

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('Staging Supabase URL is not valid.');
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname.endsWith('.supabase.co')
  ) {
    fail('Staging Supabase URL is not an allowed HTTPS Supabase origin.');
  }

  const projectRef = parsed.hostname.slice(0, -'.supabase.co'.length);
  if (!projectRef || projectRef === PRODUCTION_SUPABASE_REF) {
    fail('refusing the Production Supabase project.');
  }

  return { origin: parsed.origin, projectRef };
}

export async function verifyStagingSchemaCapabilities(
  env = process.env,
  { fetchImpl = globalThis.fetch } = {}
) {
  const stagingUrl =
    env.STAGING_SUPABASE_URL ||
    env.STAGING_EXPECTED_SUPABASE_URL ||
    env.SUPABASE_URL;
  const serviceKey = env.STAGING_SUPABASE_SECRET_KEY || env.SUPABASE_SECRET_KEY;
  const { origin, projectRef } = resolveStagingSupabaseOrigin(stagingUrl);

  if (!serviceKey) {
    fail('Staging Supabase server secret is required for schema capability proof.');
  }
  if (typeof fetchImpl !== 'function') {
    fail('fetch is unavailable for Staging schema capability proof.');
  }

  for (const rpc of REQUIRED_RPCS) {
    const response = await fetchImpl(`${origin}/rest/v1/rpc/${rpc}`, {
      method: 'OPTIONS',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`
      },
      signal: AbortSignal.timeout(20_000)
    });

    if (!response.ok) {
      fail(`required Staging RPC ${rpc} is unavailable (HTTP ${response.status}).`);
    }

    const allow = String(response.headers?.get?.('allow') ?? '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    if (!allow.includes('POST')) {
      fail(`required Staging RPC ${rpc} is not exposed as a callable RPC.`);
    }
  }

  console.log(
    `Verified Staging checkout schema capabilities for ${projectRef}: ${REQUIRED_RPCS.length} RPCs.`
  );
  return { projectRef, rpcs: [...REQUIRED_RPCS] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyStagingSchemaCapabilities();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
