import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const PARSER_PATH = 'scripts/extract-supabase-pending.sh';
const VERIFY_PATH = 'scripts/verify-supabase-pending.sh';
const WORKFLOW_PATH = '.github/workflows/supabase-production-auto-deploy.yml';
const VERIFY_PARSER = 'bash scripts/extract-supabase-pending.sh "$output_file"';
const POST_DEPLOY_PARSER =
  'pending_migrations="$(bash scripts/extract-supabase-pending.sh';
const LEGACY_PARSER = "awk -F '│'";
const bashAvailable =
  spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;

async function parseMigrationList(content) {
  const directory = await mkdtemp(join(tmpdir(), 'novelight-pending-'));
  const fixturePath = join(directory, 'migration-list.txt');

  try {
    await writeFile(fixturePath, content, 'utf8');
    const result = spawnSync('bash', [PARSER_PATH, fixturePath], {
      encoding: 'utf8'
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
  'parses the ASCII Supabase CLI migration table',
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
  'accepts legacy Unicode table separators',
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
  'ignores migrations already present in Remote history',
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

test('production migration checks share one parser', async () => {
  const [verifyScript, workflow] = await Promise.all([
    readFile(VERIFY_PATH, 'utf8'),
    readFile(WORKFLOW_PATH, 'utf8')
  ]);

  assert.equal(verifyScript.includes(VERIFY_PARSER), true);
  assert.equal(workflow.includes(POST_DEPLOY_PARSER), true);
  assert.equal(verifyScript.includes(LEGACY_PARSER), false);
  assert.equal(workflow.includes(LEGACY_PARSER), false);
});
