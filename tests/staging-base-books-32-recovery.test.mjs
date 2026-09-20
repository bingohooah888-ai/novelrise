import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import { generateCoverMaskPng } from '../api/_lib/cover-mask-png.js';
import {
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
  assert.match(workflow, /--mode=verify/);
  assert.match(workflow, /verify-staging-migrations\.sh parity/);
  assert.match(workflow, /RECOVERY_CLAIMED/);
  assert.match(workflow, /RECOVERY_CONSUMED/);
});

test('recovery implementation never has a Production server credential or Production write call', () => {
  assert.match(script, /const PROD_KEY = 'sb_publishable_/);
  assert.doesNotMatch(script, /PROD.*SECRET|service_role/iu);
  assert.match(script, /\.from\('novel_thumbnail_assets'\)\s*\.select/);
  assert.doesNotMatch(
    script,
    /prod\.[\s\S]{0,120}\.(insert|update|upsert|delete|rpc|storage)/u
  );
});
