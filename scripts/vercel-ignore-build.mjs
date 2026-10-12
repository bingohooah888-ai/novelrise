import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAFE_ROOT_FILES = new Set([
  'README.md',
  'AGENTS.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE.md'
]);
const SAFE_PREFIXES = ['docs/', 'tests/', '.github/'];

/**
 * Only skip a Production build when every changed path is known not to affect
 * the deployed application. Unknown paths and incomplete context fail open.
 */
export function shouldIgnoreProductionBuild({ environment, ref, changedPaths }) {
  if (environment !== 'production') return false;
  if (ref && ref !== 'main') return false;
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) return false;

  return changedPaths.every(
    (path) =>
      typeof path === 'string' &&
      path.length > 0 &&
      !path.includes('\\') &&
      !path.split('/').includes('..') &&
      (SAFE_ROOT_FILES.has(path) ||
        SAFE_PREFIXES.some((prefix) => path.startsWith(prefix) && path.length > prefix.length))
  );
}

export function readChangedPaths(options = {}) {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', 'HEAD^', 'HEAD', '--'],
    { encoding: 'utf8', cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return output.split('\0').filter(Boolean);
}

function main() {
  // The ignored-build-step contract is inverted: 0 = skip, 1 = build.
  // Fail open for Preview, unknown environment, and unexpected git failures.
  const environment = process.env.VERCEL_ENV;
  const ref = process.env.VERCEL_GIT_COMMIT_REF;
  if (environment !== 'production' || (ref && ref !== 'main')) {
    console.log('Vercel build guard: build (not confirmed Production main).');
    process.exitCode = 1;
    return;
  }

  try {
    const changedPaths = readChangedPaths();
    const ignored = shouldIgnoreProductionBuild({ environment, ref, changedPaths });
    console.log(
      ignored
        ? 'Vercel build guard: skip documentation/test-only Production commit.'
        : 'Vercel build guard: build (application change or unknown diff).'
    );
    process.exitCode = ignored ? 0 : 1;
  } catch {
    console.log('Vercel build guard: build (git comparison unavailable).');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
