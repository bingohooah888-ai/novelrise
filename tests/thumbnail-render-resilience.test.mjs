import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [composer, runtime, renderApi, post, edit, migration] = await Promise.all([
  readFile('novelight-thumbnail-composer.js', 'utf8'),
  readFile('novelight-thumbnail-runtime.js', 'utf8'),
  readFile('api/_lib/thumbnail-render.js', 'utf8'),
  readFile('post.html', 'utf8'),
  readFile('novel-edit.html', 'utf8'),
  readFile(
    'supabase/migrations/20260928023000_thumbnail_render_resilience.sql',
    'utf8'
  )
]);

test('thumbnail composer fails closed after bounded automatic retries', () => {
  assert.match(composer, /const RENDER_RETRY_DELAYS_MS = \[0, 500, 1500\]/u);
  assert.match(composer, /renderAndCacheWithRetry/u);
  assert.match(composer, /retryableRenderError/u);
  assert.match(composer, /action: 'report-failure'/u);
  assert.match(composer, /throw finalError/u);
  assert.doesNotMatch(
    composer,
    /return \{ composition: saved, render, renderError \}/u
  );
  assert.doesNotMatch(
    composer,
    /state\.dirty = false;\s*return \{ composition: saved, render, renderError/u
  );

  assert.doesNotThrow(() => new Function(composer));
});

test('new-post flow cannot navigate after a thrown thumbnail persistence failure', () => {
  assert.match(post, /await composerController\.persist/u);
  assert.match(
    post,
    /catch\(error\)[\s\S]*if\(createdNovelId\)[\s\S]*\.from\('novels'\)\.delete\(\)/u
  );
  assert.match(post, /window\.location\.href=/u);
});

test('edit flow awaits thumbnail persistence before redirecting', () => {
  assert.match(edit, /await composerController\.persist/u);
  assert.match(edit, /location\.href='novel\.html\?id='/u);
  assert.match(edit, /catch\(error\)/u);
});

test('reader runtime keeps missing cached thumbnails fail-closed', () => {
  assert.match(runtime, /novelight_thumbnail_compositions_v3/u);
  assert.match(runtime, /composition\?\.render_url/u);
  assert.match(runtime, /applyComposition/u);
  assert.doesNotMatch(runtime, /renderSelectionToCanvas/u);
  assert.doesNotMatch(runtime, /createElement\(['"]canvas['"]\)/u);
  assert.doesNotThrow(() => new Function(runtime));
});

test('thumbnail render API accepts authenticated bounded failure reports', () => {
  assert.match(renderApi, /FAILURE_STAGES/u);
  assert.match(renderApi, /async function reportFailure/u);
  assert.match(renderApi, /thumbnail_render_failures/u);
  assert.match(renderApi, /action === 'report-failure'/u);
  assert.match(renderApi, /status: 202, payload: \{ recorded: false \}/u);
});

test('migration preserves the last good render and creates private failure telemetry', () => {
  assert.match(
    migration,
    /create table if not exists public\.thumbnail_render_failures/u
  );
  assert.match(
    migration,
    /alter table public\.thumbnail_render_failures enable row level security/u
  );
  assert.match(
    migration,
    /revoke all on table public\.thumbnail_render_failures from anon, authenticated/u
  );
  assert.match(
    migration,
    /render_storage_path = public\.novel_thumbnail_compositions\.render_storage_path/u
  );
  assert.match(
    migration,
    /render_url = public\.novel_thumbnail_compositions\.render_url/u
  );
  assert.match(migration, /rendered_at = now\(\)/u);
  assert.match(migration, /set resolved_at = now\(\)/u);
  assert.doesNotMatch(
    migration,
    /on conflict \(novel_id\) do update[\s\S]{0,1000}render_url = null/u
  );
});
