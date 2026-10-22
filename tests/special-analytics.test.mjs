import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../special-analytics.js', import.meta.url), 'utf8');
const validId = '11111111-1111-4111-8111-111111111111';

function start(projectId = validId) {
  const sent = [];
  let onClick;
  const main = {
    getAttribute: (name) => name === 'data-special-project' ? projectId : '',
    addEventListener: (event, listener) => {
      if (event === 'click') onClick = listener;
    },
    contains: () => true
  };
  const document = { querySelector: (selector) => selector === 'main[data-special-project]' ? main : null };
  function fetch(url, request) {
    sent.push({ url, request, body: JSON.parse(request.body) });
    return Promise.resolve({ ok: true });
  }
  runInNewContext(source, { document, fetch });
  return { sent, onClick };
}

test('個別企画PVを専用エンドポイントに送信する', () => {
  const { sent } = start();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/special-event');
  assert.equal(sent[0].body.project_id, validId);
  assert.equal(sent[0].body.event_type, 'page_view');
  assert.equal(sent[0].body.target, '');
  assert.equal(sent[0].request.credentials, 'same-origin');
});

test('作品リンクのクリックを既存評価に影響なく匿名計測する', () => {
  const { sent, onClick } = start();
  assert.equal(typeof onClick, 'function');
  const child = { closest: () => ({ dataset: { specialEvent: 'content_click', specialTarget: validId } }) };
  onClick({ target: child });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.event_type, 'content_click');
  assert.equal(sent[1].body.target, validId);
});

test('不正な企画IDでは計測しない', () => {
  const { sent, onClick } = start('../../admin');
  assert.equal(sent.length, 0);
  assert.equal(onClick, undefined);
});
