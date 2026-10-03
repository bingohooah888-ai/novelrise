import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('episode number visibility defaults are backward compatible', () => {
  const migration = read(
    'supabase/migrations/20261004073000_add_episode_number_visibility.sql'
  );

  assert.match(
    migration,
    /add column if not exists show_episode_numbers boolean/i
  );
  assert.match(
    migration,
    /update public\.novels\s+set show_episode_numbers = true\s+where show_episode_numbers is null/i
  );
  assert.match(migration, /show_episode_numbers set default false/i);
  assert.match(migration, /show_episode_numbers set not null/i);
});

test('author edit runtime persists the episode number toggle', () => {
  const source = read('novelight-tags.js');

  assert.match(source, /話数番号の表示/);
  assert.match(source, /showEpisodeNumbers/);
  assert.match(
    source,
    /update\(\{ show_episode_numbers: checkbox\.checked \}\)/
  );
});

test('reader runtimes hide automatic episode labels when disabled', () => {
  const novelSource = read('novelight-novel-poll.js');
  const episodeSource = read('novelight-episode-heart.js');

  assert.match(novelSource, /select\('show_episode_numbers'\)/);
  assert.match(novelSource, /#episodeList \.episode-number/);
  assert.match(episodeSource, /select\('show_episode_numbers'\)/);
  assert.match(episodeSource, /#card>\.number/);
});
