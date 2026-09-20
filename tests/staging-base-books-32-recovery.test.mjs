import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';
import { generateCoverMaskPng } from '../api/_lib/cover-mask-png.js';
import {
  cleanupRecoveryActor,
  createRecoveryActor,
  validateProductionRows,
  validateRecoveryEnvironment,
  verifyOfficialBookBytes
} from '../scripts/staging-base-books-32-recover.mjs';

const workflow = await readFile(
  new URL(
    '../.github/workflows/staging-base-books-32-recovery.yml',
    import.meta.url
  ),
  'utf8'
);
const script = await readFile(
  new URL('../scripts/staging-base-books-32-recover.mjs', import.meta.url),
  'utf8'
);

const STAGING_URL = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const PROD_URL = 'https://fiepaguycecrredwrcwx.supabase.co';

function recoveryEnv(overrides = {}) {
  return {
    STAGING_SUPABASE_URL: STAGING_URL,
    STAGING_SUPABASE_SECRET_KEY: 'sb_secret_example',
    RECOVERY_CONFIRMATION: 'RECOVER STAGING BASE BOOKS 32',
    ...overrides
  };
}

function manifestFixture() {
  return {
    items: Array.from({ length: 32 }, (_, index) => ({
      displayOrder: index + 1,
      fileName: `base_book_fixture_${index + 1}.png`,
      sha256: String(index + 1)
        .padStart(64, '0')
        .slice(-64)
    }))
  };
}

function productionRows(manifest) {
  return manifest.items.map((item) => ({
    sort_order: item.displayOrder,
    source_file_name: item.fileName,
    source_sha256: item.sha256,
    image_url: `${PROD_URL}/storage/v1/object/public/novel-thumbnails/official/${item.displayOrder}.png`,
    availability_status: 'active',
    is_active: true
  }));
}

test('recovery target is pinned to the dedicated Staging project', () => {
  assert.deepEqual(validateRecoveryEnvironment(recoveryEnv()), {
    stagingUrl: STAGING_URL,
    secret: 'sb_secret_example'
  });
  assert.throws(
    () =>
      validateRecoveryEnvironment(
        recoveryEnv({ STAGING_SUPABASE_URL: PROD_URL })
      ),
    /refusing a non-canonical Staging Supabase target/
  );
  assert.throws(
    () =>
      validateRecoveryEnvironment(
        recoveryEnv({ RECOVERY_CONFIRMATION: 'YES' })
      ),
    /confirmation does not match/
  );
});

test('Production source validation is exact, read-only, and pack-order bound', () => {
  const manifest = manifestFixture();
  const rows = productionRows(manifest);
  assert.equal(validateProductionRows(rows, manifest).size, 32);
  const wrongHash = rows.map((row) => ({ ...row }));
  wrongHash[0].source_sha256 = 'f'.repeat(64);
  assert.throws(
    () => validateProductionRows(wrongHash, manifest),
    /metadata mismatch/
  );
  const wrongHost = rows.map((row) => ({ ...row }));
  wrongHost[0].image_url = `${STAGING_URL}/storage/v1/object/public/novel-thumbnails/official/1.png`;
  assert.throws(
    () => validateProductionRows(wrongHost, manifest),
    /escaped the public official thumbnail bucket/
  );
});

test('downloaded official PNGs are byte-size, SHA, and PNG-geometry verified', () => {
  const png = generateCoverMaskPng(
    {
      top_left: { x: 2, y: 2 },
      top_right: { x: 18, y: 2 },
      bottom_right: { x: 18, y: 28 },
      bottom_left: { x: 2, y: 28 }
    },
    20,
    30
  );
  const item = {
    fileName: 'fixture.png',
    size: png.byteLength,
    sha256: createHash('sha256').update(png).digest('hex'),
    width: 20,
    height: 30,
    bitDepth: 8,
    colorType: 6
  };
  assert.equal(verifyOfficialBookBytes(png, item), true);
  const corrupted = Buffer.from(png);
  corrupted[corrupted.length - 1] ^= 1;
  assert.throws(
    () => verifyOfficialBookBytes(corrupted, item),
    /SHA-256 mismatch/
  );
});

test('recovery workflow is one-time, owner-only, main-bound, and Staging-only', () => {
  assert.match(workflow, /github\.event\.issue\.number == 294/);
  assert.match(
    workflow,
    /github\.event\.comment\.author_association == 'OWNER'/
  );
  assert.match(workflow, /NOVELIGHT_STAGING_BASE_BOOKS_32_RECOVERY_APPROVE/);
  assert.match(workflow, /RECOVER STAGING BASE BOOKS 32/);
  assert.match(workflow, /20260920204000/);
  assert.match(workflow, /environment: staging/);
  assert.match(
    workflow,
    /STAGING_SUPABASE_SECRET_KEY: \$\{\{ secrets\.STAGING_SUPABASE_SECRET_KEY \}\}/
  );
  assert.match(
    workflow,
    /STAGING_DATABASE_URL_SOURCE: \$\{\{ secrets\.STAGING_DATABASE_URL \}\}/
  );
  assert.doesNotMatch(
    workflow,
    /PRODUCTION_SUPABASE_SECRET|SUPABASE_SERVICE_ROLE_KEY/
  );
  assert.match(
    workflow,
    /Re-bind exact current main immediately before writes/
  );
  assert.match(workflow, /--mode=precheck/);
  assert.match(workflow, /--mode=recover/);
  assert.match(workflow, /STAGING_RECOVERY_ACTOR_FILE/);
  assert.match(workflow, /Ensure ephemeral Staging recovery actor is removed/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /--mode=cleanup-actor/);
  assert.match(workflow, /--mode=verify/);
  assert.match(workflow, /verify-staging-migrations\.sh parity/);
  assert.match(
    workflow,
    /supabase\/setup-cli@3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf/
  );
  assert.match(workflow, /version: 2\.111\.0/);
  assert.match(workflow, /RECOVERY_CLAIMED/);
  assert.match(workflow, /RECOVERY_CONSUMED/);
});

test('ephemeral Staging recovery actor is real, isolated, and removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'novelight-recovery-actor-'));
  const actorFile = join(dir, 'actor.json');
  const userId = '123e4567-e89b-42d3-a456-426614174000';
  let createdInput = null;
  const deleted = [];
  const staging = {
    auth: {
      admin: {
        async createUser(input) {
          createdInput = input;
          return { data: { user: { id: userId } }, error: null };
        },
        async deleteUser(id) {
          deleted.push(id);
          return { data: {}, error: null };
        }
      }
    },
    from(table) {
      if (table === 'founding_authors') {
        return {
          select() {
            return {
              async eq() {
                return { data: [], error: null };
              }
            };
          }
        };
      }
      if (table === 'profiles') {
        return {
          select() {
            return {
              async eq() {
                return { count: 0, error: null };
              }
            };
          }
        };
      }
      throw new Error(`unexpected table ${table}`);
    }
  };

  try {
    const env = {
      STAGING_RECOVERY_ACTOR_FILE: actorFile,
      GITHUB_RUN_ID: '35537236520'
    };
    const actor = await createRecoveryActor(staging, env);
    assert.equal(actor.id, userId);
    assert.equal(createdInput.email_confirm, true);
    assert.equal(createdInput.app_metadata.internal_staging_recovery, true);
    assert.equal(createdInput.app_metadata.github_run_id, '35537236520');
    assert.match(createdInput.email, /^novelight-staging-recovery-/);
    assert.equal(JSON.parse(await readFile(actorFile, 'utf8')).userId, userId);

    assert.deepEqual(await cleanupRecoveryActor(staging, env), {
      deleted: true
    });
    assert.deepEqual(deleted, [userId]);
    await assert.rejects(readFile(actorFile, 'utf8'), { code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('recovery implementation never has a Production server credential or Production write call', () => {
  assert.match(script, /const PROD_KEY = 'sb_publishable_/);
  assert.doesNotMatch(script, /PROD.*SECRET|service_role/iu);
  assert.match(script, /\.from\('novel_thumbnail_assets'\)\s*\.select/);
  assert.doesNotMatch(
    script,
    /prod\.[\s\S]{0,120}\.(insert|update|upsert|delete|rpc|storage)/u
  );
  assert.match(script, /auth\.admin\.createUser/);
  assert.match(script, /auth\.admin\.deleteUser/);
  assert.doesNotMatch(script, /const auditUserId = randomUUID\(\)/);
});
