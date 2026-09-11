import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const migrationPath = path.join(
  root,
  'supabase/migrations/20260911123000_fix_thumbnail_asset_registration_path.sql',
);
const rollbackPath = path.join(
  root,
  'supabase/rollback/20260911123000_fix_thumbnail_asset_registration_path_rollback.sql',
);

const migration = fs.readFileSync(migrationPath, 'utf8');
const rollback = fs.readFileSync(rollbackPath, 'utf8');

const signature =
  'public.novelight_admin_register_thumbnail_layer_asset(\n' +
  '  p_admin_user_id uuid,\n' +
  '  p_label text,\n' +
  '  p_storage_path text,\n' +
  '  p_image_url text,\n' +
  '  p_layer_type text,\n' +
  '  p_template_key text,\n' +
  '  p_sort_order integer default 1000,\n' +
  "  p_status text default 'active'\n" +
  ')';

const fixedPattern = '^official/[0-9a-f-]{36}[.](webp|png|jpg|jpeg)$';
const previousPattern = '^official/[0-9a-f-]{36}\\\\.(webp|png|jpg|jpeg)$';

test('thumbnail registration RPC fixes official path matcher', () => {
  assert.ok(migration.includes(`create or replace function ${signature}`));
  assert.ok(migration.includes(`if v_path !~ '${fixedPattern}' then`));
  assert.ok(!migration.includes(`if v_path !~ '${previousPattern}' then`));

  assert.ok(migration.includes('returns setof public.novel_thumbnail_assets'));
  assert.ok(migration.includes('security definer'));
  assert.ok(migration.includes('set search_path = pg_catalog, public'));
  assert.ok(migration.includes("'thumbnail.layer.create'"));

  assert.ok(
    migration.includes(
      'revoke all on function public.novelight_admin_register_thumbnail_layer_asset(',
    ),
  );
  assert.ok(migration.includes(') from public, anon, authenticated;'));
  assert.ok(
    migration.includes(
      'grant execute on function public.novelight_admin_register_thumbnail_layer_asset(',
    ),
  );
  assert.ok(migration.includes(') to service_role;'));
});

test('canonical official paths avoid backslash-sensitive escaping', () => {
  const canonicalPaths = [
    'official/6913be0a-e2c7-4ab6-8b93-653c165ac030.png',
    'official/00000000-0000-0000-0000-000000000000.webp',
    'official/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg',
    'official/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpeg',
  ];
  const invalidPaths = [
    'official/not-a-uuid.png',
    'generated-masks/book-v1/mask.png',
    'official/6913be0a-e2c7-4ab6-8b93-653c165ac030.png.exe',
    '../official/6913be0a-e2c7-4ab6-8b93-653c165ac030.png',
  ];

  const equivalentMatcher = /^official\/[0-9a-f-]{36}[.](webp|png|jpg|jpeg)$/;
  for (const candidate of canonicalPaths) {
    assert.equal(equivalentMatcher.test(candidate), true, candidate);
  }
  for (const candidate of invalidPaths) {
    assert.equal(equivalentMatcher.test(candidate), false, candidate);
  }

  assert.ok(
    migration.includes(
      "'official/00000000-0000-0000-0000-000000000000.png'",
    ),
  );
});

test('rollback preserves the same privilege boundary', () => {
  assert.ok(rollback.includes(`create or replace function ${signature}`));
  assert.ok(rollback.includes(`if v_path !~ '${previousPattern}' then`));
  assert.ok(rollback.includes('security definer'));
  assert.ok(rollback.includes('set search_path = pg_catalog, public'));
  assert.ok(rollback.includes(') from public, anon, authenticated;'));
  assert.ok(rollback.includes(') to service_role;'));
});
