import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createGithubApiBudgetFetch } from '../tools/novelight-commander/src/github-api-budget.js';

const { Response } = globalThis;
const src = 'tools/novelight-commander/src/';

// prettier-ignore
test('shared GitHub budget spaces parallel requests across all NLO bridge workers', async () => {
  let clock = 1000;
  const times = [];
  const budget = createGithubApiBudgetFetch({
    fetchImpl: async () => {
      times.push(clock);
      return new Response('{}', { status: 200 });
    },
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    spacingMs: 1200
  });

  await Promise.all(
    Array.from({ length: 4 }, () =>
      budget.fetch('https://api.github.com/repos/example/repo/issues/1')
    )
  );
  assert.deepEqual(times, [1000, 2200, 3400, 4600]);
});

// prettier-ignore
test('primary rate limit pauses subsequent GitHub calls until reset without extra traffic', async () => {
  let clock = 1000;
  let calls = 0;
  const budget = createGithubApiBudgetFetch({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('API rate limit exceeded', {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '91'
          }
        });
      }
      return new Response('{}', { status: 200 });
    },
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    }
  });

  assert.equal((await budget.fetch('https://api.github.com/first')).status, 403);
  assert.ok(budget.getPausedUntil() >= 93_000);
  assert.equal((await budget.fetch('https://api.github.com/second')).status, 429);
  assert.equal(calls, 1);
  clock = budget.getPausedUntil() + 1;
  assert.equal((await budget.fetch('https://api.github.com/third')).status, 200);
  assert.equal(calls, 2);
});

// prettier-ignore
test('ordinary 403 permissions errors do not trigger a global rate-limit pause', async () => {
  let calls = 0;
  const budget = createGithubApiBudgetFetch({
    fetchImpl: async () => {
      calls += 1;
      return new Response('Resource not accessible', { status: 403 });
    },
    spacingMs: 0
  });

  await budget.fetch('https://api.github.com/a');
  await budget.fetch('https://api.github.com/b');
  assert.equal(calls, 2);
  assert.equal(budget.getPausedUntil(), 0);
});

// prettier-ignore
test('non-GitHub requests are not delayed or modified', async () => {
  let calls = 0;
  const budget = createGithubApiBudgetFetch({
    fetchImpl: async () => {
      calls += 1;
      return new Response('OK');
    },
    spacingMs: 180_000
  });

  assert.equal((await budget.fetch('https://example.org/health')).status, 200);
  assert.equal((await budget.fetch('https://example.org/health')).status, 200);
  assert.equal(calls, 2);
});

// prettier-ignore
test('bridge starts shared budget before workers and avoids restart storms on quota exhaustion', async () => {
  const [entry, core] = await Promise.all([
    readFile(src + 'github-bridge-daemon.js', 'utf8'),
    readFile(src + 'github-bridge-core.js', 'utf8')
  ]);
  assert.ok(
    entry.indexOf("import './github-api-budget-bootstrap.js';") <
      entry.indexOf("import './github-bridge-core.js';")
  );
  assert.match(core, /__novelightGithubApiBudget\?\.getPausedUntil\(\)/);
  assert.match(core, /pollSeconds: Math\.max\(20,/);
});

// prettier-ignore
test('independent NLO pollers no longer each poll GitHub every 10 seconds', async () => {
  const workers = [
    'scout-badge-live-bridge.js',
    'master-project-sync-bridge.js',
    'master-auto-sync-status-bridge.js',
    'master-profile-repair-bridge-v2.js',
    'author-badge-register22-v2-bridge.js',
    'author-badge-register13-bridge.js',
    'public-header-logo-bridge.js',
    'public-header-logo-special-bridge.js',
    'public-header-logo-asset-bridge.js',
    'scout-lock-artwork-bridge.js',
    'scout-lock-artwork-final-bridge.js',
    'scout-lock-local-cache-bridge.js',
    'scout-lock-direct-register-bridge.js'
  ];
  for (const name of workers) {
    const worker = await readFile(src + name, 'utf8');
    assert.match(worker, /(?:POLL_MS|POLL_INTERVAL_MS) = 60_000;/);
    assert.doesNotMatch(worker, /(?:POLL_MS|POLL_INTERVAL_MS) = 10_?000;/);
  }
});
