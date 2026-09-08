import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const novelHtml = fs.readFileSync(new URL('novel.html', root), 'utf8');
const episodeHtml = fs.readFileSync(new URL('episode.html', root), 'utf8');
const episodePostHtml = fs.readFileSync(
  new URL('episode-post.html', root),
  'utf8'
);
const mypageHtml = fs.readFileSync(new URL('mypage.html', root), 'utf8');
const novelEditHtml = fs.readFileSync(new URL('novel-edit.html', root), 'utf8');
const migration = fs.readFileSync(
  new URL('supabase/migrations/20260908130000_beta_runtime_hardening.sql', root),
  'utf8'
);

test('novel detail warning gate defers full data and telemetry', () => {
  assert.match(
    novelHtml,
    /select\('id,user_id,title,genre,ai_usage,status,content_rating,content_warnings,created_at'\)/
  );
  assert.match(
    novelHtml,
    /if\(needsWarningGate\(\)&&!warningAccepted\(\)\)\{showWarningGate\(\);return\}/
  );
  assert.match(novelHtml, /async function loadFullNovelAndRender\(\)/);
  assert.match(
    novelHtml,
    /rememberWarningAccepted\(\);await loadFullNovelAndRender\(\)/
  );
  assert.match(novelHtml, /void recordOpen\(\)/);
});

test('episode warning gate fetches content only after confirmation', () => {
  assert.match(
    episodeHtml,
    /select\('id,novel_id,user_id,status,episode_number,title,pv'\)/
  );
  assert.match(
    episodeHtml,
    /select\('id,novel_id,user_id,episode_number,title,content,status,pv'\)/
  );
  assert.match(
    episodeHtml,
    /if\(!isAuthor&&novelNeedsGate\(\)&&!warningAccepted\(\)\)\{showGate\(\);return\}/
  );
  assert.match(
    episodeHtml,
    /rememberWarningAccepted\(\);await loadEpisodeContentAndRender\(\)/
  );
  assert.doesNotMatch(episodeHtml, /select\('\*'\)\.eq\('id',episodeId\)/);
});

test('episode posting validates beta input limits before RPC', () => {
  assert.match(episodePostHtml, /maxlength="100000"/);
  assert.match(
    episodePostHtml,
    /if\(!Number\.isFinite\(episodeNumber\)\|\|episodeNumber<1\)/
  );
  assert.match(
    episodePostHtml,
    /if\(title\.length<1\|\|title\.length>150\)/
  );
  assert.match(episodePostHtml, /if\(content\.trim\(\)\.length<1\)/);
  assert.match(episodePostHtml, /if\(content\.length>100000\)/);
});

test('author room self-heals profiles and avoids DOM globals', () => {
  assert.match(mypageHtml, /async function ensureOwnProfile\(\)/);
  assert.match(mypageHtml, /client\.rpc\('novelight_ensure_my_profile'\)/);
  assert.match(
    mypageHtml,
    /const st=document\.getElementById\('analyticsStatus'\),metrics=\{/
  );
  assert.doesNotMatch(mypageHtml, /\bi\.textContent=num\(t\.i\)/);
  assert.doesNotMatch(mypageHtml, /\bfav\.textContent=num\(t\.v\)/);
});

test('novel editing requires an official thumbnail', () => {
  assert.match(
    novelEditHtml,
    /作品に合う画像<span class="required">必須<\/span>/
  );
  assert.match(
    novelEditHtml,
    /if\(!thumbnailAsset\)\{status\.textContent='作品に合う画像を1枚選んでください。';return\}/
  );
  assert.match(novelEditHtml, /thumbnail_asset_id:thumbnailAsset/);
});

test('database boundary enforces beta runtime rules', () => {
  assert.match(migration, /alter column thumbnail_asset_id set not null/);
  assert.match(migration, /raise exception 'Official thumbnail is required'/);
  assert.match(
    migration,
    /create or replace function public\.novelight_ensure_my_profile\(\)/
  );
  assert.match(migration, /char_length\(v_content\) > 100000/);
  assert.match(migration, /p_episode_number is null or p_episode_number < 1/);
  assert.match(
    migration,
    /char_length\(v_title\) < 1 or char_length\(v_title\) > 150/
  );
});
