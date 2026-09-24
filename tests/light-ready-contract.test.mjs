import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const episodePost = await readFile('episode-post.html', 'utf8');

test('公開チェック is scoped to draft first publication', () => {
  assert.ok(episodePost.includes('公開チェック'));
  assert.ok(!episodePost.includes('LIGHT READY｜公開前チェック'));
  assert.ok(episodePost.includes("novel.status!=='draft'"));
  assert.ok(episodePost.includes("novel?.status==='draft'&&episodeNumber!==1"));
  assert.ok(episodePost.includes('初回公開は第1話として登録してください。'));
});

test('公開チェック uses deterministic beta checks only', () => {
  assert.ok(episodePost.includes('novel?.title?.trim()'));
  assert.ok(episodePost.includes('novel?.genre?.trim()'));
  assert.ok(episodePost.includes('novel?.description?.trim()'));
  assert.ok(episodePost.includes('novel?.content_rating'));
  assert.ok(episodePost.includes('novel?.content_warnings'));
  assert.ok(
    episodePost.includes('episodeTitle.length>=1&&episodeTitle.length<=150')
  );
  assert.ok(
    episodePost.includes(
      'episodeContent.trim().length>=1&&episodeContent.length<=100000'
    )
  );
  assert.ok(episodePost.includes('作品の良し悪しは判定しません。'));
});

test('公開チェック preserves atomic publication contract', () => {
  assert.ok(
    episodePost.includes("client.rpc('novelight_publish_episode_atomic'")
  );
  assert.ok(!episodePost.includes("client.from('episodes').insert"));
  assert.ok(!episodePost.includes("client.from('novels').update"));
});

test('公開チェック stays advisory for metadata checks', () => {
  const renderStart = episodePost.indexOf('function renderLightReady()');
  const listenerStart = episodePost.indexOf(
    "['episodeNumber','title','content']"
  );
  assert.ok(renderStart >= 0 && listenerStart > renderStart);
  const renderFunction = episodePost.slice(renderStart, listenerStart);
  assert.ok(!renderFunction.includes('publish.disabled'));
  assert.ok(episodePost.includes("lightReadyEdit.href='novel-edit.html?id='"));
});
