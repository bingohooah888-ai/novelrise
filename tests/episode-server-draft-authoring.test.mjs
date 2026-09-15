import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const post = await readFile('episode-post.html', 'utf8');
const edit = await readFile('episode-edit.html', 'utf8');
const drafts = await readFile('episode-drafts.html', 'utf8');

test('new episode authoring can save an account-backed server draft', () => {
  assert.match(post, /id="saveDraft"/u);
  assert.match(post, /novelight_save_episode_draft/u);
  assert.match(post, /p_episode_id:\s*null/u);
  assert.match(post, /episode-edit\.html\?id=/u);
  assert.match(post, /clearCurrentDraft/u);
});

test('draft editing saves through the authenticated draft RPC and can publish atomically', () => {
  assert.match(edit, /episode\.status\s*===\s*['"]draft['"]/u);
  assert.match(edit, /novelight_save_episode_draft/u);
  assert.match(edit, /p_episode_id:\s*id/u);
  assert.match(edit, /id="publishDraft"/u);
  assert.match(edit, /novelight_publish_episode_draft_atomic/u);
});

test('published episode editing keeps the existing owner-bound update path', () => {
  assert.match(edit, /client\.from\(['"]episodes['"]\)\.update/u);
  assert.match(edit, /\.eq\(['"]user_id['"],session\.user\.id\)/u);
});

test('server draft list covers ordinary saved drafts and bulk-imported drafts', () => {
  assert.match(drafts, /通常の執筆中に保存した下書き/u);
  assert.match(drafts, /一括移行/u);
  assert.match(drafts, /novelight_publish_episode_draft_atomic/u);
});
