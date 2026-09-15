import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const runtime = read('novelight-author-draft.js');
const post = read('episode-post.html');
const edit = read('episode-edit.html');

test('episode authoring surfaces load the local safety runtime', () => {
  for (const [path, html] of [
    ['episode-post.html', post],
    ['episode-edit.html', edit]
  ]) {
    assert.match(
      html,
      /<script src="novelight-author-draft\.js"><\/script>/,
      `${path} must load local autosave and preview`
    );
  }
});

test('author draft runtime autosaves locally and offers explicit recovery', () => {
  assert.match(runtime, /novelight:episode-draft:v1:/);
  assert.match(runtime, /window\.localStorage\.setItem/);
  assert.match(runtime, /自動保存済み/);
  assert.match(runtime, /復元する/);
  assert.match(runtime, /破棄する/);
  assert.match(runtime, /700/);
});

test('preview is escaped through textContent and does not publish or mutate Supabase', () => {
  assert.match(runtime, /content\.textContent = value\.content/);
  assert.match(runtime, /title\.textContent = value\.title/);
  assert.match(runtime, /プレビュー/);
  assert.doesNotMatch(runtime, /\.from\(/);
  assert.doesNotMatch(runtime, /\.rpc\(/);
});

test('existing atomic episode publication remains the publication path', () => {
  assert.match(post, /client\.rpc\('novelight_publish_episode_atomic',args\)/);
  assert.match(post, /status\.textContent='公開しています\.\.\.'/);
});
