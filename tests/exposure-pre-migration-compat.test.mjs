import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(join(root.pathname, path), 'utf8');
const migrationPath =
  'supabase/migrations/20260831210000_trusted_allocation_receipts.sql';
const legacyRecorder = "client.rpc('record_novel_impressions";
const legacyRevoke =
  'revoke all on function public.record_novel_impressions_v2';

test('trusted exposure pre-migration compatibility', async () => {
  const [home, search, migration] = await Promise.all([
    read('index.html'),
    read('search.html'),
    read(migrationPath)
  ]);

  for (const page of [home, search]) {
    assert.match(page, /missingTrustedRpc/);
    assert.match(page, /PGRST202/);
    assert.match(page, /novelight_discovery_feed_v2/);
    assert.equal(page.includes(legacyRecorder), false);
  }

  assert.match(home, /novelight_plan_extra_feed/);
  assert.match(home, /record_trusted_allocation_receipts/);
  assert.match(search, /trustedExposureAvailable=false/);
  assert.match(search, /trustedExposureAvailable===true&&batch\.length/);
  assert.match(search, /record_neutral_search_impressions/);
  assert.match(search, /record_trusted_allocation_receipts/);
  assert.equal(migration.includes(legacyRevoke), true);
  assert.match(migration, /neutral_search_impression_telemetry/);
});
