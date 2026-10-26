import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { Script } from 'node:vm';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('novel HTML and SEO routes load the publication-aware detail UI', () => {
  for (const path of ['novel.html', 'api/seo/templates/novel.html']) {
    assert.match(read(path), /novelight-novel-detail\.js/u);
    assert.match(read(path), /data-episode-status/u);
  }
});

test('author TOC distinguishes public episodes and private drafts', () => {
  const code = read('novelight-novel-detail.js');
  assert.match(code, /numberText\.includes\('下書き'\)/u);
  assert.match(code, /nl-work-toc-draft-badge/u);
  assert.match(code, /nl-work-toc-link\.is-draft/u);
  assert.match(code, /publishedRows\.length/u);
  assert.match(code, /draftRows\.length/u);
  assert.match(code, /countLabel/u);
});

test('all publishing screens parse and confirm the reader-visible episode', () => {
  const paths = [
    'my-novels.html',
    'episode-post.html',
    'episode-edit.html',
    'episode-drafts.html',
    'episode-schedule.html'
  ];
  for (const path of paths) {
    for (const match of read(path).matchAll(/<script>([\s\S]*?)<\/script>/gu)) {
      assert.doesNotThrow(() => new Script(match[1], { filename: path }));
    }
  }
  for (const path of [
    'episode-post.html',
    'episode-edit.html',
    'episode-drafts.html',
    'episode-schedule.html'
  ]) {
    assert.match(read(path), /【最終公開確認】/u);
  }
  assert.match(read('episode-edit.html'), /novelight_set_episode_publication/u);
  assert.match(read('my-novels.html'), /novelight_set_novel_publication/u);
});

test('database visibility RPCs use author ownership and invoker RLS', () => {
  const sql = read(
    'supabase/migrations/20261026145241_author_publication_visibility.sql'
  );
  assert.match(sql, /security invoker/iu);
  assert.match(sql, /auth\.uid\(\)/u);
  assert.match(sql, /e\.user_id=v_uid/u);
  assert.match(sql, /n\.user_id=v_uid/u);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.(episodes|novels)/iu);
});

test('legacy published episodes keep a stable publication timestamp', () => {
  const sql = read(
    'supabase/migrations/20261026145650_preserve_legacy_episode_publish_date.sql'
  );
  assert.match(
    sql,
    /first_published_at=coalesce\(first_published_at,created_at\)/u
  );
  assert.match(sql, /if v_episode_status='published' then/u);
});
