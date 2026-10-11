import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  readRecoveryPlan,
  verifyCanonicalArtifacts,
  verifyAppliedPrefix,
  prepareMigrationPrefix
} from '../scripts/staging-backlog-recovery.mjs';

test('exact 25-version recovery manifest is complete and Git-blob pinned', async () => {
  const plan = await readRecoveryPlan();
  const artifact = await verifyCanonicalArtifacts(plan);
  assert.equal(artifact.localVersions.length, 158);
  assert.equal(artifact.baselineVersions.length, 133);
  assert.equal(plan.immutableMigrations.length, 25);
  assert.equal(plan.immutableMigrations[0].version, '20261001080000');
  assert.equal(plan.immutableMigrations.at(-1).version, '20261011160000');
});

test('migration-history verification requires exact applied prefix, not just count', async () => {
  const plan = await readRecoveryPlan();
  const artifact = await verifyCanonicalArtifacts(plan);
  const baseline = artifact.baselineVersions.join('\n') + '\n';
  assert.equal(verifyAppliedPrefix(artifact, plan, baseline, 0).appliedCount, 0);
  const one = [...artifact.baselineVersions, plan.immutableMigrations[0].version];
  assert.equal(
    verifyAppliedPrefix(artifact, plan, one.sort().join('\n') + '\n', 1).appliedCount,
    1
  );
  assert.throws(
    () => verifyAppliedPrefix(artifact, plan, baseline, 1),
    /history row count/
  );
  assert.throws(
    () => verifyAppliedPrefix(
      artifact,
      plan,
      baseline.replace('20260930153337', '20260930210000'),
      0
    ),
    /history differs/
  );
  assert.throws(
    () => verifyAppliedPrefix(artifact, plan, baseline + '20990101000000\n', 0),
    /history row count/
  );
});

test('isolated CLI working tree contains exactly one forward migration', async () => {
  const plan = await readRecoveryPlan();
  const artifact = await verifyCanonicalArtifacts(plan);
  const directory = await mkdtemp(join(tmpdir(), 'staging-recovery-prefix-'));
  try {
    const result = await prepareMigrationPrefix(plan, artifact, 0, {
      destination: directory
    });
    assert.equal(result.current, '20261001080000');
    assert.equal(result.count, 134);
    const files = await readdir(join(directory, 'supabase/migrations'));
    assert.equal(files.length, 134);
    assert.equal(
      files.filter((file) => file.startsWith('20261001080000_')).length,
      1
    );
    assert.equal(
      files.filter((file) => file.startsWith('20261001081500_')).length,
      0
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('rejects manifest mutation and unreviewed migration hashes', async () => {
  const plan = await readRecoveryPlan();
  const mutated = structuredClone(plan);
  mutated.immutableMigrations[0].gitBlobSha = '0'.repeat(40);
  await assert.rejects(
    verifyCanonicalArtifacts(mutated),
    /source content checksum mismatch/
  );
  const missing = structuredClone(plan);
  missing.immutableMigrations.pop();
  const temp = await mkdtemp(join(tmpdir(), 'staging-recovery-manifest-'));
  const path = join(temp, 'manifest.json');
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, JSON.stringify(missing));
    await assert.rejects(readRecoveryPlan(path), /plan contract drifted/);
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
});
