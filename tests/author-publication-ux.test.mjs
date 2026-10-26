import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('work detail module is served on both novel HTML paths', () => {
  for (const path of ['novel.html', 'api/seo/templates/novel.html']) {
    assert.match(read(path), /<script src="novelight-novel-detail\.js"><\/script>/u);
  }
});

test('author work TOC carries private draft status and displays separated counts', () => {
  const code = read('novelight-novel-detail.js');
  assert.match(code, /numberText\.includes\('下書き'\)/u);
  assert.match(code, /nl-work-toc-draft-badge/u);
  assert.match(code, /publishedRows\.length/u);
  assert.match(code, /draftRows\.length/u);
});

test('new publication screens parse and require author confirmation', () => {
  for (const path of ['my-novels.html', 'episode-post.html', 'episode-edit.html', 'episode-drafts.html']) {
    const html = read(path);
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/gu)) {
      assert.doesNotThrow(() => new Script(match[1], { filename: path }));
    }
  }
  assert.match(read('episode-post.html'), /【最終公開確認】/u);
  assert.match(read('episode-edit.html'), /novelight_set_episode_publication/u);
  assert.match(read('my-novels.html'), /novelight_set_novel_publication/u);
});

test('unpublish RPCs are invoker-scoped, owner-authorized, and preserve content', () => {
  const sql = read('supabase/migrations/20261026143000_author_publication_visibility.sql');
  assert.match(sql, /security invoker/iu);
  assert.match(sql, /auth\.uid\(\)/u);
  assert.match(sql, /e\.user_id=v_uid/u);
  assert.match(sql, /n\.user_id=v_uid/u);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.(episodes|novels)/iu);
});
