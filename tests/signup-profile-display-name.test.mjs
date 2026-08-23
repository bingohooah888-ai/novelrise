import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(join(root.pathname, path), 'utf8');

test('signup display name is preserved in the profile row', async () => {
  const [signup, mypage, migration] = await Promise.all([
    read('signup.html'),
    read('mypage.html'),
    read('supabase/migrations/20260823192500_profile_display_name_from_signup_metadata.sql')
  ]);

  assert.match(signup, /data:\{display_name:name\}/);
  assert.match(mypage, /profiles'\)\.select\('display_name,bio,plan,payment_status'\)/);
  assert.match(migration, /raw_user_meta_data\s*->>\s*'display_name'/);
  assert.match(migration, /before insert on public\.profiles/);
  assert.match(migration, /update public\.profiles p/);
});
