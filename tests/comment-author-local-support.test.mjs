import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile('novelight-comments.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const { summarizeAuthorComments, replyExample } =
  context.window.NovelightComments;

test('local summary counts only eligible rows and visible reply status', () => {
  const rows = [
    { can_moderate: true, is_hidden: false, author_reply_body: null },
    {
      can_moderate: true,
      is_hidden: false,
      author_reply_body: '返信',
      is_spoiler: true
    },
    { can_moderate: true, is_hidden: true, author_reply_body: null },
    { can_moderate: false, is_hidden: false },
    { can_moderate: true }
  ];
  const before = JSON.stringify(rows);
  assert.deepEqual({ ...summarizeAuthorComments(rows) }, {
    total: 4,
    visible: 2,
    unreplied: 1,
    spoilers: 1
  });
  assert.equal(JSON.stringify(rows), before);
  assert.equal(summarizeAuthorComments(null).total, 0);
  assert.equal(summarizeAuthorComments(Array(80).fill(rows[0])).total, 50);
});

test('reply examples are fixed text and reject unknown keys', () => {
  for (const kind of ['thanks', 'question', 'feedback']) {
    assert.equal(typeof replyExample(kind), 'string');
    assert.ok(replyExample(kind).length > 0);
  }
  assert.equal(replyExample('constructor'), null);
  assert.equal(replyExample('unknown'), null);
});

test('the author tools are presentation only and reset on read failure', () => {
  const start = source.indexOf('  function renderAuthorCommentTools(');
  const end = source.indexOf('  function renderFeed(', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /if \(!state\.isAuthor\) return;/u);
  assert.match(body, /panel\.hidden = true;/u);
  assert.match(body, /output\.readOnly = true;/u);
  assert.doesNotMatch(body, /\.rpc\(|fetch\(|innerHTML|localStorage/u);
  assert.match(source, /renderAuthorCommentTools\(state, \[\]\)/u);
});
