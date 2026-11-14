// Read-only assessment of long-lived Supabase Staging migration drift.
// No direct SQL writes, db push, migration repair, or workflow dispatch are permitted.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  compareMigrationVersions,
  readRemoteMigrationVersions,
  resolveStagingProjectRef
} from './verify-staging-migration-parity.mjs';

const MIGRATION_FILE = /^([0-9]{14})_(.+)\.sql$/;
const VERSION = /^[0-9]{14}$/;

function validatedVersions(versions, label) {
  if (!Array.isArray(versions) || versions.some((v) => typeof v !== 'string' || !VERSION.test(v))) {
    throw new Error(label + ': migration versions must be 14-digit strings');
  }
  if (new Set(versions).size !== versions.length) {
    throw new Error(label + ': duplicate migration history versions');
  }
  return [...versions].sort();
}

function sqlDmlMarkers(sql) {
  // Advisory text scan only: function bodies can contain dormant writes.
  // Never interpret the absence of a marker as proof that a migration is safe.
  const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  const markers = [];
  for (const [label, pattern] of [
    ['INSERT', /\binsert\s+into\b/i],
    ['UPDATE', /\bupdate\s+(?:only\s+)?(?:public\.)?[a-z_][\w]*\b/i],
    ['DELETE', /\bdelete\s+from\b/i],
    ['TRUNCATE', /\btruncate\b/i],
    ['DROP', /\bdrop\s+(?:table|function|policy|trigger|column)\b/i]
  ]) {
    if (pattern.test(withoutComments)) markers.push(label);
  }
  return markers;
}

export function assessStagingMigrationRecovery({
  localMigrations,
  remoteVersions,
  checkNames,
  rollbackNames
}) {
  if (!Array.isArray(localMigrations)) throw new Error('localMigrations must be an array');
  const local = localMigrations.map(({ name, sql }) => {
    const match = String(name).match(MIGRATION_FILE);
    if (!match || typeof sql !== 'string') {
      throw new Error('Malformed canonical local migration filename or content');
    }
    return { version: match[1], name, sql };
  });
  const localVersions = validatedVersions(local.map((entry) => entry.version), 'repository');
  const stagingVersions = validatedVersions(remoteVersions, 'Staging');
  const { missingRemote, unexpectedRemote } = compareMigrationVersions(
    localVersions,
    stagingVersions
  );
  const checkFiles = new Set(checkNames);
  const rollbackFiles = new Set(rollbackNames);
  const byVersion = new Map(local.map((entry) => [entry.version, entry]));

  const pending = missingRemote.map((version) => {
    const { name, sql } = byVersion.get(version);
    const prechecks = [...checkFiles].filter(
      (file) => file.startsWith(version + '_') && file.endsWith('_precheck.sql')
    );
    const postchecks = [...checkFiles].filter(
      (file) => file.startsWith(version + '_') && file.endsWith('_postcheck.sql')
    );
    const rollbacks = [...rollbackFiles].filter(
      (file) => file.startsWith(version + '_') && file.endsWith('_rollback.sql')
    );
    const dmlMarkers = sqlDmlMarkers(sql);
    return {
      version,
      name,
      artifacts: {
        precheck: prechecks.length === 1,
        postcheck: postchecks.length === 1,
        rollback: rollbacks.length === 1
      },
      artifactCountConflict:
        prechecks.length > 1 || postchecks.length > 1 || rollbacks.length > 1,
      advisorySqlMutationMarkers: dmlMarkers,
      manualReviewRequired: true
    };
  });

  const blockers = [];
  if (unexpectedRemote.length) blockers.push('UNEXPECTED_STAGING_MIGRATION_HISTORY');
  if (pending.length > 1) blockers.push('MULTIPLE_PENDING_MIGRATIONS');
  if (pending.some((item) =>
    Object.values(item.artifacts).some((present) => !present) || item.artifactCountConflict
  )) blockers.push('MISSING_OR_AMBIGUOUS_SAFETY_ARTIFACTS');
  if (pending.some((item) => item.advisorySqlMutationMarkers.length)) {
    blockers.push('POTENTIAL_DATA_MUTATION_REQUIRES_MANUAL_REVIEW');
  }

  return {
    mode: 'READ_ONLY_STAGING_MIGRATION_RECOVERY_ASSESSMENT',
    migrationParity: pending.length === 0 && unexpectedRemote.length === 0,
    automaticRepairAllowed: false,
    localMigrationCount: localVersions.length,
    stagingAppliedCount: stagingVersions.length,
    missingOnStaging: missingRemote,
    unexpectedOnStaging: unexpectedRemote,
    blockers,
    pending
  };
}

export async function auditStagingMigrationRecovery(
  env = process.env,
  {
    root = '.',
    fetchImpl = globalThis.fetch,
    remoteReader = readRemoteMigrationVersions
  } = {}
) {
  const stagingUrl =
    env.STAGING_SUPABASE_URL ||
    env.STAGING_EXPECTED_SUPABASE_URL ||
    env.SUPABASE_URL;
  // Refuse Production or malformed origins before any network access.
  const projectRef = resolveStagingProjectRef(stagingUrl);
  const dir = join(root, 'supabase/migrations');
  const migrationNames = (await readdir(dir))
    .filter((name) => MIGRATION_FILE.test(name))
    .sort();
  const localMigrations = await Promise.all(migrationNames.map(async (name) => ({
    name,
    sql: await readFile(join(dir, name), 'utf8')
  })));

  const [remoteVersions, checkNames, rollbackNames] = await Promise.all([
    remoteReader({
      accessToken: env.SUPABASE_ACCESS_TOKEN,
      projectRef,
      fetchImpl
    }),
    readdir(join(root, 'supabase/checks')),
    readdir(join(root, 'supabase/rollback'))
  ]);

  return {
    stagingProjectRef: projectRef,
    ...assessStagingMigrationRecovery({
      localMigrations,
      remoteVersions,
      checkNames,
      rollbackNames
    })
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await auditStagingMigrationRecovery();
    console.log(JSON.stringify(result, null, 2));
    if (!result.migrationParity) process.exitCode = 2;
  } catch (error) {
    console.error('STAGING_RECOVERY_AUDIT_FAILED: ' + error.message);
    process.exitCode = 1;
  }
}
