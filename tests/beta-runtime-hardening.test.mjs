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

const novelSafeSelect =
  "select('id,user_id,title,genre,ai_usage,status," +
  "content_rating,content_warnings,created_at')";
const novelGateReturn =
  'if(needsWarningGate()&&!warningAccepted()){' +
  'showWarningGate();return}';
const episodeMetaSelect =
  "select('id,novel_id,user_id,status," +
  "episode_number,title,pv')";
const episodeContentSelect =
  "select('id,novel_id,user_id,episode_number," +
  "title,content,status,pv')";
const episodeGateReturn =
  'if(!isAuthor&&novelNeedsGate()&&!warningAccepted()){' +
  'showGate();return}';
const thumbnailMissingStatus =
  "if(!thumbnailAsset){status.textContent='作品に合う画像を1枚選んでください。';return}";

test('novel detail warning gate defers full data and telemetry', () => {
  assert.ok(novelHtml.includes(novelSafeSelect));
  assert.ok(novelHtml.includes(novelGateReturn));
  assert.ok(novelHtml.includes('async function loadFullNovelAndRender()'));
  assert.ok(
    novelHtml.includes('rememberWarningAccepted();await loadFullNovelAndRender()')
  );
  assert.ok(novelHtml.includes('void recordOpen()'));
});

test('episode warning gate fetches content only after confirmation', () => {
  assert.ok(episodeHtml.includes(episodeMetaSelect));
  assert.ok(episodeHtml.includes(episodeContentSelect));
  assert.ok(episodeHtml.includes(episodeGateReturn));
  assert.ok(
    episodeHtml.includes('rememberWarningAccepted();await loadEpisodeContentAndRender()')
  );
  assert.equal(episodeHtml.includes("select('*').eq('id',episodeId)"), false);
});

test('episode posting validates beta input limits before RPC', () => {
  assert.ok(episodePostHtml.includes('maxlength="100000"'));
  assert.ok(
    episodePostHtml.includes(
      'if(!Number.isFinite(episodeNumber)||episodeNumber<1)'
    )
  );
  assert.ok(
    episodePostHtml.includes('if(title.length<1||title.length>150)')
  );
  assert.ok(episodePostHtml.includes('if(content.trim().length<1)'));
  assert.ok(episodePostHtml.includes('if(content.length>100000)'));
});

test('author room self-heals profiles and uses explicit metric elements', () => {
  assert.ok(mypageHtml.includes('async function ensureOwnProfile()'));
  assert.ok(mypageHtml.includes("client.rpc('novelight_ensure_my_profile')"));
  assert.ok(
    mypageHtml.includes(
      "const st=document.getElementById('analyticsStatus'),metrics={"
    )
  );
  assert.ok(mypageHtml.includes('metrics.i.textContent=num(t.i)'));
  assert.ok(mypageHtml.includes('metrics.fav.textContent=num(t.v)'));
});

test('novel editing requires an official thumbnail', () => {
  assert.ok(
    novelEditHtml.includes('作品に合う画像<span class="required">必須</span>')
  );
  assert.ok(novelEditHtml.includes(thumbnailMissingStatus));
  assert.ok(novelEditHtml.includes('thumbnail_asset_id:thumbnailAsset'));
});

test('database boundary enforces beta runtime rules', () => {
  assert.ok(migration.includes('alter column thumbnail_asset_id set not null'));
  assert.ok(migration.includes("raise exception 'Official thumbnail is required'"));
  assert.ok(
    migration.includes('create or replace function public.novelight_ensure_my_profile()')
  );
  assert.ok(migration.includes('char_length(v_content) > 100000'));
  assert.ok(
    migration.includes('p_episode_number is null or p_episode_number < 1')
  );
  assert.ok(
    migration.includes('char_length(v_title) < 1 or char_length(v_title) > 150')
  );
});
