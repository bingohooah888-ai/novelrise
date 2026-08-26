import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';

const PRODUCTION_VERCEL_HOST = 'novelrise.vercel.app';
const PRODUCTION_SUPABASE_HOST = 'fiepaguycecrredwrcwx.supabase.co';
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function fail(category, message) {
  const error = new Error(`${category}: ${message}`);
  error.category = category;
  throw error;
}

function parseOrigin(name, value, hostnameSuffix) {
  if (!value) fail('CONFIG_DRIFT', `${name} is not configured.`);

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('CONFIG_DRIFT', `${name} is not a valid URL.`);
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    (hostnameSuffix && !parsed.hostname.endsWith(hostnameSuffix))
  ) {
    fail('CONFIG_DRIFT', `${name} is not an allowed HTTPS origin.`);
  }

  return parsed;
}

function resolveTarget(env) {
  const trigger = env.STAGING_TRIGGER || '';
  let candidate = '';
  let source = '';

  if (trigger === 'workflow_dispatch') {
    if (env.MANUAL_STAGING_URL) {
      candidate = env.MANUAL_STAGING_URL;
      source = 'workflow input';
    } else {
      candidate = env.CANONICAL_STAGING_URL || '';
      source = 'STAGING_BASE_URL repository variable';
    }
  } else {
    if (env.DEPLOYMENT_ENVIRONMENT_URL) {
      candidate = env.DEPLOYMENT_ENVIRONMENT_URL;
      source = 'deployment environment_url';
    } else {
      candidate = env.DEPLOYMENT_TARGET_URL || '';
      source = 'deployment target_url';
    }
  }

  const parsed = parseOrigin('Staging deployment URL', candidate, '.vercel.app');
  if (parsed.hostname === PRODUCTION_VERCEL_HOST) {
    fail('CONFIG_DRIFT', 'refusing the Production Vercel host.');
  }

  return { baseUrl: parsed.origin, source };
}

function expectedSupabaseUrl(env) {
  const parsed = parseOrigin(
    'STAGING_SUPABASE_URL',
    env.STAGING_EXPECTED_SUPABASE_URL,
    '.supabase.co'
  );
  if (parsed.hostname === PRODUCTION_SUPABASE_HOST) {
    fail('CONFIG_DRIFT', 'refusing the Production Supabase project.');
  }
  return parsed.origin;
}

function publishableFingerprint(value) {
  if (!value) {
    fail('CONFIG_DRIFT', 'STAGING_SUPABASE_PUBLISHABLE_KEY is not configured.');
  }
  return createHash('sha256').update(value).digest('hex');
}

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('CONFIG_DRIFT', `${name} is unavailable in deployed environment facts.`);
  }
}

function validateEnvironmentFacts({ facts, baseUrl, expectedRevision, env }) {
  assertObject(facts, 'environment facts');

  if (facts.commitSha !== expectedRevision) {
    return {
      converged: false,
      observedRevision:
        typeof facts.commitSha === 'string' ? facts.commitSha : 'unavailable'
    };
  }

  if (facts.vercelEnv !== 'preview') {
    fail(
      'CONFIG_DRIFT',
      `deployed VERCEL_ENV must be preview, observed ${facts.vercelEnv || 'missing'}.`
    );
  }

  if (facts.appBaseUrl !== baseUrl) {
    fail(
      'CONFIG_DRIFT',
      'deployed Preview app base URL does not match the verified deployment URL.'
    );
  }

  if (env.STAGING_REQUIRE_WRITE_CONFIG !== 'true') {
    return { converged: true, observedRevision: facts.commitSha };
  }

  const expectedSupabase = expectedSupabaseUrl(env);
  const expectedPublishableFingerprint = publishableFingerprint(
    env.STAGING_EXPECTED_PUBLISHABLE_KEY
  );

  assertObject(facts.supabase, 'Supabase facts');
  if (facts.supabase.url !== expectedSupabase) {
    fail(
      'CONFIG_DRIFT',
      'deployed Supabase URL does not match GitHub-owned STAGING_SUPABASE_URL.'
    );
  }
  if (!['publishable', 'legacy-anon'].includes(facts.supabase.publishableKeyClass)) {
    fail(
      'CONFIG_DRIFT',
      `deployed Supabase browser key class is ${facts.supabase.publishableKeyClass || 'missing'}.`
    );
  }
  if (
    facts.supabase.publishableKeyFingerprint !== expectedPublishableFingerprint
  ) {
    fail(
      'CONFIG_DRIFT',
      'deployed Supabase publishable key does not match the GitHub Staging expectation.'
    );
  }
  if (facts.supabase.serverSecretPresent !== true) {
    fail('CONFIG_DRIFT', 'deployed Staging Supabase server secret is missing.');
  }

  assertObject(facts.stripe, 'Stripe facts');
  if (facts.stripe.secretKeyMode !== 'test') {
    fail(
      'CONFIG_DRIFT',
      `deployed Stripe secret key mode must be test, observed ${facts.stripe.secretKeyMode || 'missing'}.`
    );
  }
  if (
    facts.stripe.standardPricePresent !== true ||
    facts.stripe.premiumPricePresent !== true
  ) {
    fail('CONFIG_DRIFT', 'deployed Staging Stripe Price configuration is incomplete.');
  }

  return { converged: true, observedRevision: facts.commitSha };
}

async function fetchFacts(baseUrl, bypassSecret) {
  const headers = { Accept: 'application/json' };
  if (bypassSecret) {
    headers['x-vercel-protection-bypass'] = bypassSecret;
  }

  const response = await fetch(`${baseUrl}/api/staging-environment-facts`, {
    headers,
    signal: AbortSignal.timeout(20_000)
  });

  if (response.status === 401 || response.status === 403) {
    fail(
      'CONFIG_DRIFT',
      'Vercel Deployment Protection blocked Staging environment verification.'
    );
  }

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.retryable = true;
    throw error;
  }

  try {
    return await response.json();
  } catch {
    const error = new Error('environment facts response is not valid JSON');
    error.retryable = true;
    throw error;
  }
}

export async function verifyStagingDeployment(env = process.env) {
  const expectedRevision = env.EXPECTED_REVISION || '';
  if (!COMMIT_PATTERN.test(expectedRevision)) {
    fail('CONFIG_DRIFT', 'EXPECTED_REVISION must be an exact 40-character commit SHA.');
  }

  const { baseUrl, source } = resolveTarget(env);
  let lastObserved = 'unavailable';
  let lastError = null;

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const facts = await fetchFacts(
        baseUrl,
        env.VERCEL_AUTOMATION_BYPASS_SECRET || ''
      );
      const result = validateEnvironmentFacts({
        facts,
        baseUrl,
        expectedRevision,
        env
      });
      lastObserved = result.observedRevision;

      if (result.converged) {
        if (env.GITHUB_ENV) {
          await appendFile(
            env.GITHUB_ENV,
            `STAGING_BASE_URL=${baseUrl}\nE2E_BASE_URL=${baseUrl}\n`
          );
        }
        console.log(`Validated Staging deployment from ${source}: ${baseUrl}`);
        console.log(`Verified deployed revision: ${expectedRevision}`);
        return { baseUrl, revision: expectedRevision };
      }
    } catch (error) {
      if (error?.category === 'CONFIG_DRIFT') throw error;
      lastError = error;
    }

    if (attempt < 6) {
      console.log(
        `DEPLOYMENT_NOT_CONVERGED: attempt ${attempt}/6, expected ${expectedRevision}, observed ${lastObserved}.`
      );
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  const detail = lastError?.message
    ? ` Last fetch error: ${lastError.message}.`
    : '';
  fail(
    'DEPLOYMENT_NOT_CONVERGED',
    `deployment did not expose the expected revision ${expectedRevision}; observed ${lastObserved}.${detail}`
  );
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    await verifyStagingDeployment();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
