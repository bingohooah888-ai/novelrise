import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createIsolatedWorktree } from '../src/worktree-isolation-create.js';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nlo-isolation-fixture-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const repoRoot = path.join(dir, 'repo'); const localAppData = path.join(dir, 'local');
  await fs.mkdir(repoRoot); await fs.mkdir(localAppData);
  git(repoRoot, 'init', '-b', 'main'); git(repoRoot, 'config', 'user.name', 'Fixture'); git(repoRoot, 'config', 'user.email', 'fixture@example.invalid');
  await fs.writeFile(path.join(repoRoot, 'sample.txt'), 'initial\n'); git(repoRoot, 'add', 'sample.txt'); git(repoRoot, 'commit', '-m', 'fixture');
  const expectedHead = git(repoRoot, 'rev-parse', 'HEAD');
  await fs.writeFile(path.join(repoRoot, 'sample.txt'), 'dirty data\n'); await fs.writeFile(path.join(repoRoot, 'untracked.txt'), 'preserve\n');
  const proof = { result: 'READ_ONLY_ISOLATION_PREFLIGHT', expectedHead, branchHeadVerified: true, eligibleForSeparateCreationApproval: true, locationOutsideRegisteredWorktrees: true, destinationCollision: false, diskSufficient: true, localMutationPerformed: false };
  return { repoRoot, localAppData, expectedHead, branch: 'feature/fixture', preflight: async () => proof, creationApproved: true };
}
test('creates detached exact SHA and preserves dirty tracked and untracked source files', async t => {
  const a = await fixture(t); const before = git(a.repoRoot, 'status', '--porcelain=v1');
  const result = await createIsolatedWorktree(a); assert.equal(result.head, a.expectedHead); assert.equal(result.detached, true);
  assert.equal(git(a.repoRoot, 'status', '--porcelain=v1'), before); assert.equal(await fs.readFile(path.join(a.repoRoot, 'sample.txt'), 'utf8'), 'dirty data\n'); assert.equal(await fs.readFile(path.join(a.repoRoot, 'untracked.txt'), 'utf8'), 'preserve\n');
  assert.equal(git(a.repoRoot, 'branch', '--show-current'), 'main'); assert.equal(git(a.repoRoot, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 2);
});
test('denies missing approval, invalid branch and bad preflight', async t => {
  const a = await fixture(t); await assert.rejects(createIsolatedWorktree({ ...a, creationApproved: false }), /APPROVAL_REQUIRED/); await assert.rejects(createIsolatedWorktree({ ...a, branch: 'main' }), /INVALID_SCOPE/); await assert.rejects(createIsolatedWorktree({ ...a, preflight: async () => ({}) }), /PREFLIGHT_REQUIRED/); assert.deepEqual(await fs.readdir(a.localAppData), []);
});
test('refuses destination collision and preserves existing file', async t => {
  const a = await fixture(t); await createIsolatedWorktree(a); await assert.rejects(createIsolatedWorktree(a), /DESTINATION_EXISTS/); assert.equal(git(a.repoRoot, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 2);
});
test('refuses configured checkout filters before any worktree mutation', async t => {
  const a = await fixture(t); git(a.repoRoot, 'config', 'filter.fixture.smudge', 'fixture-untrusted-command'); await assert.rejects(createIsolatedWorktree(a), /EXTERNAL_FILTER_OR_PROMISOR/); assert.deepEqual(await fs.readdir(a.localAppData), []);
});
test('refuses symlink in candidate tree', async t => {
  if (process.platform === 'win32') return t.skip('requires symlink fixture permission');
  const a = await fixture(t); await fs.symlink('/tmp', path.join(a.repoRoot, 'link')); git(a.repoRoot, 'add', 'link'); git(a.repoRoot, 'commit', '-m', 'symlink'); const expectedHead = git(a.repoRoot, 'rev-parse', 'HEAD'); const p = await a.preflight(); await assert.rejects(createIsolatedWorktree({ ...a, expectedHead, preflight: async () => ({ ...p, expectedHead }) }), /LINK_OR_SUBMODULE/);
});
test('refuses drift before worktree creation', async t => {
  const a = await fixture(t); const proof = await a.preflight(); let calls = 0; await assert.rejects(createIsolatedWorktree({ ...a, preflight: async () => (++calls === 1 ? proof : { ...proof, branchHeadVerified: false }) }), /PREFLIGHT_DRIFT/); assert.equal(git(a.repoRoot, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);
});
