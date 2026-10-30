// Offline-only, read-only preflight for AI consent Staging readiness.
// Never contacts Supabase, runs SQL, reads credentials or accepts a mutation.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  compareMigrationLedgers,
  readLocalMigrationVersions
} from './check-ai-review-migration-parity.mjs';

const PRODUCTION_REF = 'fiepaguycecrredwrcwx';
const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';

export function assessAiConsentStagingParity({
  stagingRef,
  productionRef,
  local,
  staging,
  production
} = {}) {
  if (
    stagingRef !== STAGING_REF ||
    productionRef !== PRODUCTION_REF ||
    stagingRef === productionRef
  ) {
    return {
      ready: false,
      reason: 'STAGING_TARGET_UNVERIFIED'
    };
  }

  const parity = compareMigrationLedgers({
    local,
    staging,
    production
  });
  return {
    ready: parity.ok,
    reason: parity.ok ? 'LEDGER_PARITY_OK' : 'MIGRATION_LEDGER_DRIFT',
    stagingRef,
    productionRef,
    parity
  };
}

function ledger(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.migrations)) return payload.migrations;
  throw new Error('INVALID_MIGRATION_LEDGER');
}

async function main() {
  const [stagingRef, stagingFile, productionFile] = process.argv.slice(2);
  if (process.argv.length !== 5) {
    throw new Error(
      'Usage: node scripts/ai-consent-staging-parity-gate.mjs ' +
        '<staging-ref> <staging-versions.json> <production-versions.json>'
    );
  }
  // Only JSON migration versions are loaded; never accept a DB connection URL.
  const [local, staging, production] = await Promise.all([
    readLocalMigrationVersions(),
    readFile(resolve(stagingFile), 'utf8').then((raw) =>
      ledger(JSON.parse(raw))
    ),
    readFile(resolve(productionFile), 'utf8').then((raw) =>
      ledger(JSON.parse(raw))
    )
  ]);
  const result = assessAiConsentStagingParity({
    stagingRef,
    productionRef: PRODUCTION_REF,
    local,
    staging,
    production
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ready) process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
