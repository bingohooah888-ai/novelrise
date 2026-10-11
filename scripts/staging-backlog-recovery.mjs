// Dedicated Staging-only backlog recovery verifier.
// Does not connect to a database or mutate its contents. The owner-approved
// workflow provides a read-only SQL history listing and selects ONE migration.
import { readFile, readdir, mkdir, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveStagingProjectRef } from './verify-staging-migration-parity.mjs';

const PLAN = 'supabase/recovery/staging-backlog-20261011.json';
const DEST = '/tmp/novelight-staging-recovery-project';
const VERSIONED = /^([0-9]{14})_[a-z0-9_]+\.sql$/;

function refuse(message) {
  throw new Error('STAGING_BACKLOG_RECOVERY_BLOCKED: ' + message);
}

export async function readRecoveryPlan(file = PLAN) {
  const raw = JSON.parse(await readFile(file, 'utf8'));
  if (
    raw.schemaVersion !== 1 ||
    raw.mode !== 'STAGING_ONLY_BACKLOG_RECOVERY' ||
    raw.expectedStagingProjectRef !== 'wmlzjgvxgoyrovdhbqbg' ||
    raw.baselineAppliedCount !== 133 ||
    !Array.isArray(raw.immutableMigrations) ||
    raw.immutableMigrations.length !== 25
  ) refuse('plan contract drifted');
  let prev = '';
  for (const migration of raw.immutableMigrations) {
    if (
      !VERSIONED.test(migration.file) ||
      migration.file.slice(0, 14) !== migration.version ||
      !/^[a-f0-9]{40}$/.test(migration.gitBlobSha) ||
      migration.version <= prev
    ) refuse('unsorted, malformed or unpinned migration in manifest');
    prev = migration.version;
  }
  if (
    raw.baselineFirstPendingVersion !== raw.immutableMigrations[0].version ||
    raw.baselineLastPendingVersion !== raw.immutableMigrations.at(-1).version
  ) refuse('plan boundaries drifted');
  return raw;
}

export async function verifyCanonicalArtifacts(
  plan, { directory = 'supabase/migrations', gitHash = (path) =>
    execFileSync('git', ['hash-object', path], { encoding: 'utf8' }).trim() } = {}
) {
  // This recovery plan is pinned to the first 158 migrations through
  // 2026-10-11. New migrations must never enter the isolated recovery prefix.
  const allNames = (await readdir(directory)).filter((name) => VERSIONED.test(name));
  const names = allNames.filter(
    (name) => name.slice(0, 14) <= plan.baselineLastPendingVersion
  );
  if (names.length !== 158) refuse('recovery baseline migration count is no longer 158');
  const localVersions = names.map((name) => name.slice(0, 14)).sort();
  if (new Set(localVersions).size !== localVersions.length) {
    refuse('duplicate canonical migration version');
  }
  const pending = new Set(plan.immutableMigrations.map((item) => item.version));
  for (const migration of plan.immutableMigrations) {
    if (!names.includes(migration.file)) refuse('migration SQL file missing');
    if (gitHash(join(directory, migration.file)) !== migration.gitBlobSha) {
      refuse('migration source content checksum mismatch: ' + migration.version);
    }
  }
  return { localVersions, baselineVersions: localVersions.filter((v) => !pending.has(v)) };
}

export function verifyAppliedPrefix(
  { localVersions, baselineVersions }, plan, remoteText, appliedCount
) {
  if (!Number.isInteger(appliedCount) || appliedCount < 0 || appliedCount > 25) {
    refuse('invalid applied prefix length');
  }
  const remoteVersions = remoteText.trim().split(/\r?\n/u);
  if (remoteVersions.length !== 133 + appliedCount ||
      remoteVersions.some((v) => !/^[0-9]{14}$/.test(v)) ||
      new Set(remoteVersions).size !== remoteVersions.length) {
    refuse('Staging migration history row count or version format changed');
  }
  const expected = [
    ...baselineVersions,
    ...plan.immutableMigrations.slice(0, appliedCount).map((v) => v.version)
  ].sort();
  if (remoteVersions.join(',') !== expected.join(',') ||
      expected.some((v) => !localVersions.includes(v))) {
    refuse('Staging history differs from exact expected applied prefix');
  }
  return { appliedCount, next: plan.immutableMigrations[appliedCount]?.version || null };
}

export async function prepareMigrationPrefix(plan, files, appliedCount, {
  directory = 'supabase/migrations', destination = DEST
} = {}) {
  if (!Number.isInteger(appliedCount) || appliedCount < 0 || appliedCount >= 25) {
    refuse('invalid next migration index');
  }
  const current = plan.immutableMigrations[appliedCount].version;
  const names = (await readdir(directory))
    .filter((name) => VERSIONED.test(name) && name.slice(0, 14) <= current);
  if (names.length !== 134 + appliedCount) {
    refuse('isolated prefix would include unexpected migrations');
  }
  const expected = [
    ...files.baselineVersions.filter((version) => version <= current),
    ...plan.immutableMigrations.slice(0, appliedCount + 1).map((v) => v.version)
  ];
  if (names.map((name) => name.slice(0, 14)).sort().join(',') !==
      expected.sort().join(',')) {
    refuse('isolated prefix version list mismatches plan');
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(join(destination, 'supabase/migrations'), { recursive: true });
  await copyFile('supabase/config.toml', join(destination, 'supabase/config.toml'));
  for (const name of names) {
    await copyFile(join(directory, name), join(destination, 'supabase/migrations', name));
  }
  return { current, count: names.length, destination };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.argv[2];
    const index = Number(process.argv[3]);
    if (resolveStagingProjectRef(process.env.STAGING_SUPABASE_URL) !==
        'wmlzjgvxgoyrovdhbqbg') refuse('dedicated project identity mismatch');
    const plan = await readRecoveryPlan();
    const artifacts = await verifyCanonicalArtifacts(plan);
    if (mode === 'verify') {
      const remote = await readFile('/tmp/novelight-staging-recovery-history.txt', 'utf8');
      console.log(JSON.stringify(verifyAppliedPrefix(artifacts, plan, remote, index)));
    } else if (mode === 'prepare') {
      console.log(JSON.stringify(await prepareMigrationPrefix(plan, artifacts, index)));
    } else {
      refuse('usage: verify|prepare <applied-prefix-count>');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
