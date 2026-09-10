import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const episodeHtml = await readFile(new URL('../episode.html', import.meta.url), 'utf8');
const commentClient = await readFile(new URL('../novelight-comments.js', import.meta.url), 'utf8');

function includes(value) {
  assert.ok(commentClient.includes(value), `expected comment client to include ${value}`);
}

test('episode reader loads and mounts the Chapter 38 comment client', () => {
  assert.match(episodeHtml, /novelight-comments\.css/);
  assert.match(episodeHtml, /novelight-comments\.js/);
  assert.match(episodeHtml, /NovelightComments\.mount\(\{client,novel,session,isAuthor\}\)/);
});

test('comment client uses only the Chapter 38 comment RPC surface', () => {
  includes("rpc('novelight_comment_feed'");
  includes("rpc('post_novel_comment'");
  includes("rpc('delete_novel_comment'");
  assert.doesNotMatch(commentClient, /\.from\(['\"]novel_comments['\"]\)/);
  assert.doesNotMatch(commentClient, /recalculate_work_rank|novelight_recalculate_work_ranks/);
});

test('comment composer follows the foundation limits and author guard', () => {
  assert.match(commentClient, /MAX_COMMENT_LENGTH = 2000/);
  assert.match(commentClient, /if \(isAuthor\)/);
  assert.match(commentClient, /comment\.can_delete === true/);
  assert.match(commentClient, /textContent = text/);
  assert.match(commentClient, /作品Rankを直接上げることはありません/);
});
