import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { consumeLocalPermit, validateLocalPermit } from '../tools/novelight-commander/src/worktree-local-permit.js';

const binding = {
  requestId: 'cmdr-20261126T140000Z-local-fixture',
  branch: 'fix/fixture',
  expectedHead: 'a'.repeat(40)
};

function permit(now = Date.now()) {
  return { operation: 'create_isolated', ...binding, issuedAt: now - 1000, expiresAt: now + 60000 };
}

test('local permit is exact, scoped, bounded and unexpired', () => {
  const now = Date.now();
  const p = permit(now);
  assert.equal(validateLocalPermit(p, binding, now), true);
  for (const invalid of [
    { ...p, operation: 'other' },
    { ...p, branch: 'other' },
    { ...p, expectedHead: 'b'.repeat(40) },
    { ...p, requestId: 'other' },
    { ...p, expiresAt: now },
    { ...p, expiresAt: now + 16 * 60000 },
    { ...p, issuedAt: now + 1000 },
    { ...p, arbitrary: true }
  ]) {
    assert.throws(() => validateLocalPermit(invalid, binding, now), /NLO_LOCAL_PERMIT_DENIED/);
  }
});

test('local permit denies absence and permits exactly one durable claim', async (t) => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nlo-permit-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const state = path.join(dir, 'state.json');
  await assert.rejects(consumeLocalPermit(state, binding), /NLO_LOCAL_PERMIT_DENIED/);
  await fs.writeFile(path.join(dir, 'worktree-create-local-permit.json'), JSON.stringify(permit()));
  const results = await Promise.allSettled([
    consumeLocalPermit(state, binding),
    consumeLocalPermit(state, binding)
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  await assert.rejects(consumeLocalPermit(state, { ...binding, approvalId: 99 }), /NLO_LOCAL_PERMIT_DENIED/);
});

test('local permit denies a linked permit file', async (t) => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nlo-permit-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'other.json');
  await fs.writeFile(source, JSON.stringify(permit()));
  await fs.link(source, path.join(dir, 'worktree-create-local-permit.json'));
  await assert.rejects(consumeLocalPermit(path.join(dir, 'state.json'), binding), /NLO_LOCAL_PERMIT_DENIED/);
});
