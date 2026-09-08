import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [client, shellRuntime, shellStyles] = await Promise.all([
  readFile('novelight-client.js', 'utf8'),
  readFile('novelight-author-studio-shell.js', 'utf8'),
  readFile('novelight-author-studio-shell.css', 'utf8')
]);

test('creator pages load the shared Author Studio shell', () => {
  for (const slug of ['post', 'my-novels', 'analytics', 'scout-record']) {
    assert.match(client, new RegExp(`'${slug}'`));
  }
  assert.match(client, /novelight-author-studio-shell\.css/);
  assert.match(client, /novelight-author-studio-shell\.js/);
  assert.match(client, /novelight-author-studio-shell/);
});

test('shared shell matches the creator-room navigation contract', () => {
  const expectedItems = [
    ['mypage.html', '創作室'],
    ['post.html', '新規投稿'],
    ['my-novels.html', '自分の作品'],
    ['analytics.html', 'LIGHT ANALYTICS'],
    ['scout-record.html', 'SCOUT RECORD']
  ];

  for (const [href, label] of expectedItems) {
    assert.match(shellRuntime, new RegExp(href.replace('.', '\\.')));
    assert.ok(shellRuntime.includes(label));
  }

  assert.doesNotMatch(shellRuntime, />設定</);
  assert.match(shellRuntime, /aria-current/);
  assert.match(shellRuntime, /読者ホームへ/);
  assert.match(shellRuntime, /ログアウト/);
});

test('shared shell reuses the creator-room sidebar artwork and responsive layout', () => {
  assert.match(shellStyles, /author-room-sidebar-background\.webp/);
  assert.match(shellStyles, /novelight-author-room-logo\.webp/);
  assert.match(shellStyles, /margin-left:\s*244px/);
  assert.match(shellStyles, /@media \(max-width: 900px\)/);
  assert.match(shellStyles, /transform:\s*translateX\(-104%\)/);
});
