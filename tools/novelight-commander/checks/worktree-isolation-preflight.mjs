import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isolatedWorktreeTarget,
  inspectIsolatedWorktree
} from '../src/worktree-isolation-preflight.js';

const ROOT = '/private/bridge-dirty-repository';
const LOCAL = '/private/AppData/Local';
const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const BRANCH = 'feature/owner-approved-isolation';
const SECOND = '/private/OneDrive/Documents/GitHub/novelrise';
const TARGET = isolatedWorktreeTarget(LOCAL, BRANCH);
const records =
  'worktree ' + ROOT + '\0HEAD ' + OTHER + '\0detached\0\0' +
  'worktree ' + SECOND + '\0HEAD ' + OTHER +
  '\0branch refs/heads/main\0\0';

function mock(options = {}) {
  const calls = [];
  const git = async (cwd, args) => {
    calls.push({ type: 'git', cwd, args });
    if (args.join(' ') === 'rev-parse --show-toplevel') {
      return ROOT + '\n';
    }
    if (args.join(' ') === 'worktree list --porcelain -z') {
      return options.worktrees ?? records;
    }
    throw new Error('FORBIDDEN_GIT_WRITE');
  };
  const lstat = async (candidate) => {
    calls.push({ type: 'lstat', candidate });
    if (candidate === LOCAL || (options.collision && candidate.startsWith(LOCAL + path.sep))) {
      return {
        isSymbolicLink: () => false,
        isDirectory: () => true
      };
    }
    if (candidate === path.join(LOCAL, 'NOVELIGHT') && options.symlink) {
      return {
        isSymbolicLink: () => true,
        isDirectory: () => true
      };
    }
    throw Object.assign(new Error('no filesystem entry'), { code: 'ENOENT' });
  };
  const realpath = async (candidate) => {
    calls.push({ type: 'realpath', candidate });
    return candidate;
  };
  const statfs = async (candidate) => {
    calls.push({ type: 'statfs', candidate });
    if (options.failDisk) {
      throw new Error('/private/hidden/SECRET_PASSWORD');
    }
    return {
      bavail: options.lowDisk ? 200000n : 1000000n,
      bsize: 4096n
    };
  };
  const inspect = (overrides = {}) => inspectIsolatedWorktree({
    repoRoot: ROOT,
    localAppData: LOCAL,
    branch: BRANCH,
    expectedHead: HEAD,
    remoteHead: HEAD,
    git,
    lstat,
    realpath,
    statfs,
    ...overrides
  });
  return { inspect, calls };
}

test('read-only preflight verifies branch, disk, worktrees and target', async () => {
  const f = mock();
  const result = await f.inspect();
  assert.equal(result.controlIssue, 1837);
  assert.equal(result.result, 'READ_ONLY_ISOLATION_PREFLIGHT');
  assert.equal(result.branchHeadVerified, true);
  assert.equal(result.registeredWorktreeCount, 2);
  assert.equal(result.destinationCollision, false);
  assert.equal(result.diskSufficient, true);
  assert.equal(result.eligibleForSeparateCreationApproval, true);
  assert.equal(result.requiresSeparateCreationApproval, true);
  assert.equal(result.localMutationPerformed, false);
  assert.equal(result.filesAndPathsExposed, false);
  assert.deepEqual(
    f.calls.filter((call) => call.type === 'git').map((call) => call.args),
    [
      ['rev-parse', '--show-toplevel'],
      ['worktree', 'list', '--porcelain', '-z']
    ]
  );
  const publicText = JSON.stringify(result);
  for (const secret of [ROOT, LOCAL, SECOND, TARGET, 'SECRET_PASSWORD']) {
    assert.equal(publicText.includes(secret), false);
  }
});

test('unpinned remote HEAD, low disk or occupied target blocks creation', async () => {
  const changed = await mock().inspect({ remoteHead: OTHER });
  assert.equal(changed.branchHeadVerified, false);
  assert.equal(changed.eligibleForSeparateCreationApproval, false);
  const low = await mock({ lowDisk: true }).inspect();
  assert.equal(low.diskSufficient, false);
  assert.equal(low.eligibleForSeparateCreationApproval, false);
  const occupied = await mock({ collision: true }).inspect();
  assert.equal(occupied.destinationCollision, true);
  assert.equal(occupied.eligibleForSeparateCreationApproval, false);
});

test('registered worktree collision and symlinks fail closed', async () => {
  const duplicate = records + 'worktree ' + TARGET +
    '\0HEAD ' + HEAD + '\0detached\0\0';
  await assert.rejects(
    mock({ worktrees: duplicate }).inspect(),
    /NLO_ISOLATION_PREFLIGHT_UNVERIFIED/u
  );
  await assert.rejects(
    mock({ symlink: true }).inspect(),
    /NLO_ISOLATION_PREFLIGHT_UNVERIFIED/u
  );
});

test('validation rejects unsafe branch, missing local AppData or wrong head', async () => {
  for (const branch of ['main', 'foo/../bar', '../bad', 'a//b']) {
    assert.throws(
      () => isolatedWorktreeTarget(LOCAL, branch),
      /NLO_ISOLATION_PREFLIGHT_UNVERIFIED/u
    );
  }
  await assert.rejects(
    mock().inspect({ localAppData: '', branch: BRANCH }),
    /NLO_ISOLATION_PREFLIGHT_UNVERIFIED/u
  );
  await assert.rejects(
    mock().inspect({ expectedHead: 'not-a-SHA' }),
    /NLO_ISOLATION_PREFLIGHT_UNVERIFIED/u
  );
  assert.notEqual(
    isolatedWorktreeTarget(LOCAL, 'feature/a/b'),
    isolatedWorktreeTarget(LOCAL, 'feature/a_b')
  );
});

test('raw disk exception and sensitive paths never escape', async () => {
  await assert.rejects(
    mock({ failDisk: true }).inspect(),
    (error) =>
      error.message === 'NLO_ISOLATION_PREFLIGHT_UNVERIFIED' &&
      !error.message.includes('SECRET_PASSWORD')
  );
});

test('legacy Issue #797 is not used; no implicit worktree creation remains', async () => {
  const text = await readFile(
    new URL('../src/worktree-safe-bridge.js', import.meta.url),
    'utf8'
  );
  assert.match(text, /const CONTROL_ISSUE = 1837;/u);
  assert.match(text, /worktree-safe-bridge-1837-state\.json/u);
  assert.match(text, /isolation_preflight/u);
  assert.doesNotMatch(text, /git', \['worktree', 'add'/u);
  assert.doesNotMatch(text, /\.novelight-commander\/worktrees/u);
});
