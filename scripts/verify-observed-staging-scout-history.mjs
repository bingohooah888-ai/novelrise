import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Observed Staging history is NOT an OWNER-approved migration exception.
// Never pass these files to Supabase CLI or Production migration workflows.
export const OBSERVED_SCOUT_STAGING_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: '20261114062717',
    filename: '20261114062717_scout_formal_30day_safe_staging_disabled_20261114.sql',
    sha256: 'a979cfd89ee84d3675aa04c741e5006f199878eb3460e01771dc646f2ed35c7f',
    bytes: 11414
  }),
  Object.freeze({
    version: '20261114065015',
    filename: '20261114065015_scout_formal_e2e_cutover_held_20261114.sql',
    sha256: 'bc4ed82c754cc055687f405ed316733cef2815865d79de501d8684b9481921d8',
    bytes: 16187
  }),
  Object.freeze({
    version: '20261114070855',
    filename: '20261114070855_scout_formal_finality_compensation_held_20261114.sql',
    sha256: 'b43d0ac7d97a70758885aeae3261a5e1bb7d4cdd6c7687212b46ea3304936388',
    bytes: 13117
  }),
  Object.freeze({
    version: '20261114091324',
    filename: '20261114091324_scout_formal_single_window_restore_held_20261114.sql',
    sha256: '680850dce1b36320ec8e4c54cd82f0417a7213dc41e5c57c7f8786e5bbe18173',
    bytes: 7776
  })
]);

function reject(message) {
  const error = new Error('SCHEMA_DRIFT: ' + message);
  error.category = 'SCHEMA_DRIFT';
  throw error;
}

/**
 * Compare historical, read-only metadata with byte-exact archived SQL.
 * The source evidence is the 2026-11-15 Staging metadata read. This function
 * does not connect to a database, authorize application, or waive the
 * existing four-file Production migration parity gate.
 */
export async function verifyObservedScoutStagingMigrations({
  remoteRows,
  observedDir = 'supabase/staging-migrations-observed',
  productionDir = 'supabase/migrations'
} = {}) {
  if (!Array.isArray(remoteRows)) {
    reject('observed Staging history must be a metadata array.');
  }
  let files;
  try {
    files = await readdir(observedDir, { withFileTypes: true });
  } catch {
    reject('observed Staging-only archive is missing.');
  }
  const expectedFiles = new Set(
    OBSERVED_SCOUT_STAGING_MIGRATIONS.map((item) => item.filename)
  );
  if (
    files.length !== expectedFiles.size ||
    files.some((file) => !file.isFile() || !expectedFiles.has(file.name))
  ) {
    reject('observed archive must contain precisely four fixed SQL files.');
  }
  const productionFiles = await readdir(productionDir);
  if (
    productionFiles.some((name) =>
      OBSERVED_SCOUT_STAGING_MIGRATIONS.some(
        (item) => name.startsWith(item.version + '_')
      )
    )
  ) {
    reject('observed SCOUT history must not enter Production migrations.');
  }

  for (const item of OBSERVED_SCOUT_STAGING_MIGRATIONS) {
    const matches = remoteRows.filter((row) => row?.version === item.version);
    if (matches.length !== 1) {
      reject('observed Staging version missing or duplicated: ' + item.version);
    }
    const bytes = await readFile(join(observedDir, item.filename));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== item.bytes || hash !== item.sha256) {
      reject('archived Staging SQL differs from fixed source evidence: ' + item.version);
    }
    const row = matches[0];
    if (
      row.migration_name !== item.filename.slice(15, -4) ||
      row.statement_count !== 1 ||
      row.statement_sha256 !== item.sha256 ||
      row.statement_bytes !== item.bytes
    ) {
      reject('observed Staging SQL/name/hash drift: ' + item.version);
    }
  }

  // Content proof is intentionally not a release or approval decision.
  return Object.freeze({
    status: 'CONTENT_MATCH_ONLY_OWNER_APPROVAL_UNVERIFIED',
    versions: OBSERVED_SCOUT_STAGING_MIGRATIONS.map((item) => item.version)
  });
}
