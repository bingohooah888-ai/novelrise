import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const parserPath = 'scripts/extract-supabase-pending.sh';
const bashAvailable =
  spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;

async function parseMigrationList(content) {
  const directory = await mkdtemp(join(tmpdir(), 'novelight-supabase-pending-'));
  const fixturePath = join(directory, 'migration-list.txt');

  try {
    await writeFile(fixturePath, content, 'utf8');
    const result = spawnSync('bash', [parserPath, fixturePath], {
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    return result.stdout
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  'extracts Local-only migrations from the ASCII table emitted by Supabase CLI 2.111.0',
  { skip: !bashAvailable },
  async () => {
    const pending = await parseMigrationList(`
   Local            | Remote           | Time (UTC)
  ------------------|------------------|-----------------------
   \`20260815000000\` | \` \`              | \`2026-08-15 00:00:00\`
   \`20260819190000\` | \`20260819190000\` | \`2026-08-19 19:00:00\`
   \`20260822194000\` | \`20260822194000\` | \`2026-08-22 19:40:00\`
`);

    assert.deepEqual(pending, ['20260815000000']);
  }
);

test(
  'continues to accept legacy Unicode table separators',
  { skip: !bashAvailable },
  async () => {
    const pending = await parseMigrationList(`
   Local            │ Remote           │ Time (UTC)
  ------------------│------------------│-----------------------
   20260815000000   │                  │ 2026-08-15 00:00:00
   20260819190000   │ 20260819190000   │ 2026-08-19 19:00:00
`);

    assert.deepEqual(pending, ['20260815000000']);
  }
);

test(
  'does not report migrations whose Local and Remote versions both exist',
  { skip: !bashAvailable },
  async () => {
    const pending = await parseMigrationList(`
   Local            | Remote           | Time (UTC)
  ------------------|------------------|-----------------------
   20260819190000   | 20260819190000   | 2026-08-19 19:00:00
   20260822194000   | 20260822194000   | 2026-08-22 19:40:00
`);

    assert.deepEqual(pending, []);
  }
);

test('production migration checks share the same parser implementation', async () => {
  const [verifyScript, workflow] = await Promise.all([
    readFile('scripts/verify-supabase-pending.sh', 'utf8'),
    readFile('.github/workflows/supabase-production-auto-deploy.yml', 'utf8'),
  ]);

  assert.match(
    verifyScript,
    /bash scripts\/extract-supabase-pending\.sh "\$output_file"/
  );
  assert.match(
    workflow,
    /pending_migrations="\$\(bash scripts\/extract-supabase-pending\.sh \/tmp\/post-deploy-migration-list\.txt\)"/
  );
  assert.doesNotMatch(verifyScript, /awk -F '│'/);
  assert.doesNotMatch(workflow, /awk -F '│'/);
});
