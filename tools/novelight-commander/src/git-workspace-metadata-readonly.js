// Fixed read-only Git workspace metadata probe for the existing OWNER Bridge.
// Never return absolute paths, branch names (except "main"), filenames,
// porcelain text, env vars, raw Git errors, or changes to local Git state.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/u;
const MAX_WORKTREES = 16;
const MAX_GIT_OUTPUT = 512 * 1024;

function fail() {
  throw new Error('NLO_WORKSPACE_METADATA_UNAVAILABLE');
}

export async function readOnlyGit(cwd, args) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        '--no-optional-locks',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.untrackedCache=false',
        '-C',
        cwd,
        ...args
      ],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: MAX_GIT_OUTPUT,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
      }
    );
    return stdout;
  } catch {
    // stderr may contain local paths or private repository metadata.
    fail();
  }
}

function safeString(value) {
  if (typeof value !== 'string' || value.length > MAX_GIT_OUTPUT) fail();
  return value;
}

function samePath(a, b) {
  const normalized = (text) => {
    const value = path.normalize(path.resolve(text)).replace(/[\\/]+$/u, '');
    return process.platform === 'win32' ? value.toLowerCase() : value;
  };
  return normalized(a) === normalized(b);
}

export function parseWorktreeRecords(porcelain) {
  const chunks = safeString(porcelain).split('\0\0').filter(Boolean);
  if (chunks.length < 1 || chunks.length > MAX_WORKTREES) fail();
  return chunks.map((chunk) => {
    const fields = chunk.split('\0').filter(Boolean);
    const rootField = fields.find((x) => x.startsWith('worktree '));
    const headField = fields.find((x) => x.startsWith('HEAD '));
    const branchField = fields.find((x) => x.startsWith('branch '));
    const detached = fields.includes('detached');
    const bare = fields.includes('bare');
    const prunable = fields.some((x) => x.startsWith('prunable'));
    if (
      !rootField ||
      !path.isAbsolute(rootField.slice(9)) ||
      !headField ||
      !SHA.test(headField.slice(5)) ||
      (!detached && !bare && !branchField) ||
      (detached && branchField)
    ) {
      fail();
    }
    const ref = branchField?.slice(7) || '';
    if (ref && !ref.startsWith('refs/heads/')) fail();
    return {
      // This path is used ONLY to run local git commands, NEVER returned.
      cwd: rootField.slice(9),
      head: headField.slice(5),
      branchKind: bare
        ? 'bare'
        : detached
          ? 'detached'
          : ref === 'refs/heads/main'
            ? 'main'
            : 'other',
      prunable
    };
  });
}

export function countPorcelainEntries(porcelain) {
  const raw = safeString(porcelain);
  if (raw && !raw.endsWith('\0')) fail();
  const fields = raw.split('\0');
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicts = 0;
  let entries = 0;
  for (let i = 0; i < fields.length - 1; i += 1) {
    const record = fields[i];
    if (record.length < 4 || record[2] !== ' ') fail();
    const index = record[0];
    const worktree = record[1];
    entries += 1;
    if (index === '?' && worktree === '?') {
      untracked += 1;
    } else if (index === '!' && worktree === '!') {
      // Ignored files are not collected by the fixed git status command.
      fail();
    } else {
      if (index !== ' ') staged += 1;
      if (worktree !== ' ') unstaged += 1;
      if (
        index === 'U' ||
        worktree === 'U' ||
        (index === 'A' && worktree === 'A') ||
        (index === 'D' && worktree === 'D')
      ) conflicts += 1;
      if (index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C') {
        i += 1; // -z rename/copy entries contain a second path-only record.
        if (!fields[i]) fail();
      }
    }
  }
  return { dirty: entries > 0, staged, unstaged, untracked, conflicts };
}

export async function inspectNloGitWorkspaces({
  repoRoot,
  git = readOnlyGit
}) {
  if (
    typeof repoRoot !== 'string' ||
    !path.isAbsolute(repoRoot) ||
    typeof git !== 'function'
  ) fail();

  let root;
  let records;
  try {
    root = safeString(
      await git(repoRoot, ['rev-parse', '--show-toplevel'])
    ).trim();
    if (!path.isAbsolute(root)) fail();
    records = parseWorktreeRecords(
      await git(root, ['worktree', 'list', '--porcelain', '-z'])
    );
  } catch {
    fail();
  }
  if (!records.some((record) => samePath(record.cwd, root))) fail();

  const workspaces = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const configured = samePath(record.cwd, root);
    const item = {
      id: configured ? 'nlo_configured_root' : 'registered_' + (i + 1),
      configured,
      branchKind: record.branchKind,
      head: record.head,
      status: 'unavailable',
      changes: null
    };
    if (!record.prunable && record.branchKind !== 'bare') {
      try {
        item.changes = countPorcelainEntries(
          await git(record.cwd, [
            'status',
            '--porcelain=v1',
            '-z',
            '--untracked-files=normal'
          ])
        );
        item.status = 'observed';
      } catch {
        // Do not disclose exceptions, paths, or raw Git status output.
        item.status = 'unavailable';
      }
    }
    workspaces.push(item);
  }

  return {
    result: 'READ_ONLY_METADATA',
    registeredWorktreeCount: records.length,
    mainWorktreeCount: workspaces.filter((x) => x.branchKind === 'main').length,
    workspaces,
    vsCodeWorkspaceMatched: 'NOT_PROVEN_WITHOUT_INDEPENDENT_IDENTITY',
    safeToUpdate: false,
    pathsOrFileNamesExposed: false,
    mutationsPerformed: false
  };
}
