import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertCreationRootBinding } from '../tools/novelight-commander/src/worktree-creation-approval.js';
import { createWorktreeSecurity } from '../tools/novelight-commander/src/worktree-safe-bridge.js';

test('isolated creation binds the configured and permitted repository roots', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nlo-root-binding-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = await fs.realpath(temp);
  const a = path.join(root, 'configured');
  const b = path.join(root, 'other');
  await fs.mkdir(a);
  await fs.mkdir(b);

  assert.equal(await assertCreationRootBinding(a, a), true);
  await assert.rejects(
    assertCreationRootBinding(a, b),
    /NLO_CREATE_AUTHORIZATION_DENIED/
  );
  await assert.rejects(
    assertCreationRootBinding('relative', a),
    /NLO_CREATE_AUTHORIZATION_DENIED/
  );
  const missing = path.join(root, 'missing');
  await assert.rejects(
    assertCreationRootBinding(missing, missing),
    /NLO_CREATE_AUTHORIZATION_DENIED/
  );

  const alias = path.join(root, 'alias');
  await fs.symlink(a, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    assertCreationRootBinding(alias, alias),
    /NLO_CREATE_AUTHORIZATION_DENIED/
  );
});

test('worktree bridge defaults to the configured root without altering other process settings', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nlo-root-default-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const configured = await fs.realpath(temp);
  const env = {};
  const security = createWorktreeSecurity(configured, env);
  assert.equal(security.primary, configured);
  assert.deepEqual(env, {});
  assert.equal(security.allowShell, false);
  assert.equal(security.allowProduction, false);
  assert.equal(
    await assertCreationRootBinding(configured, security.primary),
    true
  );
  const other = path.dirname(configured);
  const mismatch = createWorktreeSecurity(configured, {
    NOVELIGHT_COMMANDER_ROOT: other
  });
  await assert.rejects(
    assertCreationRootBinding(configured, mismatch.primary),
    /NLO_CREATE_AUTHORIZATION_DENIED/
  );
  assert.throws(() => createWorktreeSecurity('relative', env), /DENIED/);
  assert.throws(
    () =>
      createWorktreeSecurity(configured, {
        NOVELIGHT_COMMANDER_ROOT: 'relative'
      }),
    /DENIED/
  );
});
