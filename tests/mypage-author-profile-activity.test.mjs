import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [mypage, roomCss] = await Promise.all([
  readFile('mypage.html', 'utf8'),
  readFile('novelight-author-room.css', 'utf8')
]);
const migration = await readFile(
  'supabase/migrations/20260906120000_author_profile_avatar_and_activity.sql',
  'utf8'
);

test('recent activity is left and profile is right on desktop', () => {
  assert.match(
    roomCss,
    /grid-template-columns:minmax\(0,1\.55fr\) minmax\(320px,\.82fr\)/u
  );
  assert.match(roomCss, /\.activity-panel\{grid-column:1!important/u);
  assert.match(roomCss, /\.profile-panel\{grid-column:2!important/u);
  const profile = mypage.indexOf('profile-panel');
  const activity = mypage.indexOf('activity-panel');
  assert.ok(profile >= 0);
  assert.ok(activity > profile);
});

test('avatar upload is restricted to safe author images', () => {
  assert.match(mypage, /id="avatarInput"/u);
  assert.match(mypage, /image\/jpeg,image\/png,image\/webp/u);
  assert.match(mypage, /file\.size>2097152/u);
  assert.match(mypage, /crypto\.randomUUID\(\)/u);
  assert.match(mypage, /author-avatars/u);
  assert.match(migration, /2097152/u);
  assert.match(migration, /storage\.foldername\(name\)/u);
  assert.match(migration, /auth\.uid\(\)/u);
});

test('profile writes cannot update billing fields', () => {
  assert.match(migration, /revoke update on table public\.profiles/u);
  assert.match(migration, /novelight_update_my_public_profile/u);
  assert.match(migration, /display_name = v_name/u);
  assert.match(migration, /bio = v_bio/u);
  assert.match(migration, /avatar_path = v_avatar/u);
  assert.doesNotMatch(migration, /set plan =/u);
  assert.doesNotMatch(migration, /payment_status =/u);
  assert.doesNotMatch(migration, /stripe_customer_id =/u);
});

test('recent activity uses trusted author data only', () => {
  assert.match(mypage, /novelight_author_recent_activity_v1/u);
  assert.match(migration, /first_published_at/u);
  assert.match(migration, /public\.episodes/u);
  assert.match(migration, /public\.light_seeds/u);
  assert.match(migration, /public\.novel_exposure_conversions/u);
  assert.match(migration, /author_id_snapshot = v_uid/u);
  assert.doesNotMatch(migration, /select reader_id/u);
});
