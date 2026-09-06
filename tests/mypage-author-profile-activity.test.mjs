import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [mypage, migration] = await Promise.all([
  readFile('mypage.html', 'utf8'),
  readFile('supabase/migrations/20260906120000_author_profile_avatar_and_activity.sql', 'utf8')
]);

test('author profile is the smaller left panel and recent activity is the larger right panel', () => {
  assert.match(
    mypage,
    /\.lower-grid\{grid-template-columns:minmax\(300px,\.82fr\) minmax\(0,1\.55fr\)\}/u
  );
  const profileIndex = mypage.indexOf('class="panel profile-panel"');
  const activityIndex = mypage.indexOf('class="panel activity-panel"');
  assert.ok(profileIndex >= 0, 'profile panel must exist');
  assert.ok(activityIndex > profileIndex, 'activity panel must follow the left profile panel');
  assert.match(mypage, /作品に最近起きたこと/u);
});

test('author avatar upload is limited to supported images and the authenticated author folder', () => {
  assert.match(
    mypage,
    /id="avatarInput" type="file" accept="image\/jpeg,image\/png,image\/webp"/u
  );
  assert.match(mypage, /if\(file\.size>2097152\)/u);
  assert.match(mypage, /session\.user\.id\+'\/'\+crypto\.randomUUID\(\)/u);
  assert.match(mypage, /storage\.from\('author-avatars'\)\.upload/u);
  assert.match(migration, /file_size_limit,[\s\S]*2097152/u);
  assert.match(migration, /array\['image\/webp','image\/png','image\/jpeg'\]/u);
  assert.match(
    migration,
    /\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/u
  );
});

test('profile edits are narrowed to public profile fields instead of billing columns', () => {
  assert.match(migration, /revoke update on table public\.profiles from anon, authenticated/u);
  assert.match(migration, /novelight_update_my_public_profile/u);
  assert.match(
    migration,
    /set display_name = v_name,[\s\S]*bio = v_bio,[\s\S]*avatar_path = v_avatar/u
  );
  assert.doesNotMatch(
    migration.match(/create or replace function public\.novelight_update_my_public_profile[\s\S]*?\$\$;/u)?.[0] ?? '',
    /stripe_customer_id\s*=|payment_status\s*=|plan\s*=/u
  );
  assert.match(mypage, /client\.rpc\('novelight_update_my_public_profile'/u);
});

test('recent activity is a real authenticated author feed without reader identity', () => {
  assert.match(mypage, /client\.rpc\('novelight_author_recent_activity_v1'/u);
  for (const source of [
    'first_published_at',
    'public.episodes',
    'public.light_seeds',
    'public.novel_exposure_conversions'
  ]) {
    assert.match(migration, new RegExp(source.replaceAll('.', '\\.')));
  }
  assert.match(migration, /author_id_snapshot = v_uid/u);
  assert.doesNotMatch(
    migration.match(/create or replace function public\.novelight_author_recent_activity_v1[\s\S]*?\$\$;/u)?.[0] ?? '',
    /reader_id\s+as|select\s+reader_id/u
  );
  assert.match(mypage, /light_seed_received/u);
  assert.match(mypage, /favorite_added/u);
  assert.match(mypage, /first_episode_two_read/u);
});
