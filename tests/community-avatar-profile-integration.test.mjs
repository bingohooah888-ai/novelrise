import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');

const migrationPath =
  'supabase/migrations/20261024134500_community_public_profile_avatars.sql';

test('community exposes only profile paths for already visible feed rows', () => {
  const sql = read(migrationPath);
  assert.match(
    sql,
    /'author_avatar_path', CASE WHEN p\.kind='official' THEN NULL/u
  );
  assert.match(sql, /p\.avatar_path AS author_avatar_path/u);
  for (const gate of [
    'community_runtime_control',
    'community_hidden_posts',
    'user_blocks',
    'user_mutes',
    'content_rating',
    'p_limit',
    'p_offset'
  ]) {
    assert.ok(sql.includes(gate), gate);
  }
  assert.doesNotMatch(
    sql,
    /GRANT SELECT ON (?:TABLE )?public\.profiles/u
  );
});

test('public author avatar RPC never opens private profiles', () => {
  const sql = read(migrationPath);
  assert.match(sql, /novelight_public_author_avatar\(p_user_id uuid\)/u);
  assert.match(sql, /p\.id = \(SELECT auth\.uid\(\)\)/u);
  assert.match(sql, /n\.status = 'published'/u);
  assert.match(sql, /n\.content_rating IN \('general','sensitive_15'\)/u);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.novelight_public_author_avatar/u
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.novelight_public_author_avatar/u
  );
});

test('all public author surfaces load the shared avatar painter', () => {
  for (const path of ['index.html', 'community.html', 'author.html']) {
    assert.match(read(path), /novelight-public-avatar\.js/u, path);
  }
  const script = read('novelight-public-avatar.js');
  assert.match(script, /ownedPathPattern/u);
  assert.match(script, /match\[1\]\.toLowerCase\(\) !== owner/u);
  assert.match(script, /author-avatars/u);
  assert.match(script, /image\.onerror/u);
  assert.match(read('novelight-community.js'), /row\.author_avatar_path/u);
  assert.match(read('author.html'), /novelight_public_author_avatar/u);
  assert.doesNotMatch(
    read('novelight-community.js'),
    /\.from\(['"]profiles['"]\)/u
  );
});

test('image fallback and existing profile upload contract stay untouched', () => {
  const script = read('novelight-public-avatar.js');
  assert.match(script, /holder\.replaceChildren\(fallback\)/u);
  assert.match(script, /holder\.dataset\.avatarPath/u);
  const editor = read('novelight-profile-settings.js');
  assert.match(editor, /author-avatars/u);
  assert.match(editor, /novelight_update_my_public_profile/u);
});
