import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const novelHtml = await readFile('novel.html', 'utf8');
const episodeHtml = await readFile('episode.html', 'utf8');
const episodePostHtml = await readFile('episode-post.html', 'utf8');
const mypageHtml = await readFile('mypage.html', 'utf8');
const novelEditHtml = await readFile('novel-edit.html', 'utf8');
const migration = await readFile(
  'supabase/migrations/20260908130000_beta_runtime_hardening.sql',
  'utf8'
);

test('novel warning gate defers unsafe work', () => {
  assert.ok(novelHtml.includes('title,genre,ai_usage,status'));
  assert.ok(novelHtml.includes('content_rating,content_warnings'));
  assert.ok(novelHtml.includes('showWarningGate();return'));
  assert.ok(novelHtml.includes('async function loadFullNovelAndRender()'));
  assert.ok(novelHtml.includes('await loadFullNovelAndRender()'));
  assert.ok(novelHtml.includes('void recordOpen()'));
});

test('episode warning gate defers content', () => {
  assert.ok(episodeHtml.includes('status,episode_number,title,pv'));
  assert.ok(episodeHtml.includes('title,content,status,pv'));
  assert.ok(episodeHtml.includes('showGate();return'));
  assert.ok(episodeHtml.includes('await loadEpisodeContentAndRender()'));
  assert.equal(episodeHtml.includes("select('*').eq('id',episodeId)"), false);
});

test('episode posting validates beta limits', () => {
  assert.ok(episodePostHtml.includes('maxlength="100000"'));
  assert.ok(episodePostHtml.includes('episodeNumber<1'));
  assert.ok(episodePostHtml.includes('title.length>150'));
  assert.ok(episodePostHtml.includes('content.trim().length<1'));
  assert.ok(episodePostHtml.includes('content.length>100000'));
});

test('author room avoids fragile globals', () => {
  assert.ok(mypageHtml.includes('async function ensureOwnProfile()'));
  assert.ok(mypageHtml.includes('novelight_ensure_my_profile'));
  assert.ok(mypageHtml.includes("document.getElementById('analyticsStatus')"));
  assert.ok(mypageHtml.includes('metrics.i.textContent=num(t.i)'));
  assert.ok(mypageHtml.includes('metrics.fav.textContent=num(t.v)'));
});

test('novel editing requires an official thumbnail', () => {
  assert.ok(novelEditHtml.includes('作品に合う画像'));
  assert.ok(novelEditHtml.includes('必須'));
  assert.ok(novelEditHtml.includes('if(!thumbnailAsset){'));
  assert.ok(novelEditHtml.includes('thumbnail_asset_id:thumbnailAsset'));
});

test('database boundary enforces beta rules', () => {
  assert.ok(migration.includes('alter column thumbnail_asset_id set not null'));
  assert.ok(migration.includes('Official thumbnail is required'));
  assert.ok(migration.includes('novelight_ensure_my_profile'));
  assert.ok(migration.includes('char_length(v_content) > 100000'));
  assert.ok(migration.includes('p_episode_number < 1'));
  assert.ok(migration.includes('char_length(v_title) > 150'));
});
