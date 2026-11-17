import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  countPorcelainEntries,
  inspectNloGitWorkspaces,
  parseWorktreeRecords
} from '../tools/novelight-commander/src/git-workspace-metadata-readonly.js';

const ROOT = '/private/NLO/bridge-root';
const VSCODE = '/private/OneDrive/Documents/GitHub/novelrise';
const SHA_OLD = 'a'.repeat(40);
const SHA_MAIN = 'b'.repeat(40);
const records =
  'worktree ' + ROOT + '\0' +
  'HEAD ' + SHA_OLD + '\0detached\0\0' +
  'worktree ' + VSCODE + '\0' +
  'HEAD ' + SHA_MAIN + '\0branch refs/heads/main\0\0';

function fixture(options = {}) {
  const calls = [];
  const git = async (cwd, args) => {
    calls.push({ cwd, args });
    const command = args.join(' ');
    if (command === 'rev-parse --show-toplevel') {
      return options.root ?? ROOT + '\n';
    }
    if (command === 'worktree list --porcelain -z') {
      return options.records ?? records;
    }
    if (command === 'status --porcelain=v1 -z --untracked-files=normal') {
      if (options.failStatus && cwd === VSCODE) {
        throw new Error('PATH=/private/SECRET_PASSWORD.txt');
      }
      return cwd === ROOT
        ? ' M secret-password.txt\0?? secret-token.pem\0'
        : 'M  private-credential.json\0';
    }
    throw new Error('UNEXPECTED_COMMAND');
  };
  return { git, calls };
}

test('different detached and main worktrees have independent dirty metadata', async () => {
  const f = fixture();
  const result = await inspectNloGitWorkspaces({
    repoRoot: ROOT,
    git: f.git
  });
  assert.equal(result.result, 'READ_ONLY_METADATA');
  assert.equal(result.registeredWorktreeCount, 2);
  assert.equal(result.mainWorktreeCount, 1);
  assert.deepEqual(
    result.workspaces.map((w) => ({
      id: w.id,
      branchKind: w.branchKind,
      dirty: w.changes?.dirty
    })),
    [
      {
        id: 'nlo_configured_root',
        branchKind: 'detached',
        dirty: true
      },
      {
        id: 'registered_2',
        branchKind: 'main',
        dirty: true
      }
    ]
  );
  assert.deepEqual(result.workspaces[0].changes, {
    dirty: true,
    staged: 0,
    unstaged: 1,
    untracked: 1,
    conflicts: 0
  });
  assert.equal(result.workspaces[1].changes.staged, 1);
  assert.equal(result.safeToUpdate, false);
  assert.equal(result.vsCodeWorkspaceMatched, 'NOT_PROVEN_WITHOUT_INDEPENDENT_IDENTITY');

  const text = JSON.stringify(result);
  for (const secret of [
    ROOT,
    VSCODE,
    'secret-password.txt',
    'secret-token.pem',
    'private-credential.json',
    'OneDrive'
  ]) {
    assert.equal(text.includes(secret), false);
  }
  assert.deepEqual(
    f.calls.map((x) => x.args.join(' ')),
    [
      'rev-parse --show-toplevel',
      'worktree list --porcelain -z',
      'status --porcelain=v1 -z --untracked-files=normal',
      'status --porcelain=v1 -z --untracked-files=normal'
    ]
  );
});

test('status parsing handles staged, unstaged, conflicts and -z rename pairs', () => {
  const raw =
    'R  new-secret.txt\0old-secret.txt\0' +
    'UU conflict.txt\0' +
    ' M working.txt\0' +
    '?? untracked.txt\0';
  assert.deepEqual(countPorcelainEntries(raw), {
    dirty: true,
    staged: 2,
    unstaged: 2,
    untracked: 1,
    conflicts: 1
  });
  assert.deepEqual(countPorcelainEntries(''), {
    dirty: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0
  });
});

test('only registered absolute worktrees are inspected', async () => {
  const fake = fixture({ records: records.replace(ROOT, '/other/repo') });
  await assert.rejects(
    inspectNloGitWorkspaces({ repoRoot: ROOT, git: fake.git }),
    /NLO_WORKSPACE_METADATA_UNAVAILABLE/u
  );
  const wrong = fixture({ root: 'relative-not-valid\n' });
  await assert.rejects(
    inspectNloGitWorkspaces({ repoRoot: ROOT, git: wrong.git }),
    /NLO_WORKSPACE_METADATA_UNAVAILABLE/u
  );
  assert.throws(
    () => parseWorktreeRecords('worktree SECRET\0HEAD ' + SHA_OLD + '\0detached\0\0'),
    /NLO_WORKSPACE_METADATA_UNAVAILABLE/u
  );
});

test('unavailable worktree status fails closed without exposing its error', async () => {
  const f = fixture({ failStatus: true });
  const r = await inspectNloGitWorkspaces({ repoRoot: ROOT, git: f.git });
  assert.equal(r.workspaces[1].status, 'unavailable');
  assert.equal(r.workspaces[1].changes, null);
  assert.equal(r.safeToUpdate, false);
  assert.equal(JSON.stringify(r).includes('SECRET_PASSWORD'), false);
});

test('invalid porcelain and excessive worktrees fail without raw output', async () => {
  assert.throws(
    () => countPorcelainEntries(' M secret.txt'),
    /NLO_WORKSPACE_METADATA_UNAVAILABLE/u
  );
  const many = Array.from(
    { length: 17 },
    (_, index) =>
      'worktree /repo/' + index + '\0' +
      'HEAD ' + SHA_OLD + '\0detached\0\0'
  ).join('');
  assert.throws(
    () => parseWorktreeRecords(many),
    /NLO_WORKSPACE_METADATA_UNAVAILABLE/u
  );
});
