import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const runtime = readFileSync(resolve('novelight-prepublish-check.js'), 'utf8');
const draftRuntime = readFileSync(resolve('novelight-author-draft.js'), 'utf8');
const browser = { window: {} };
vm.runInNewContext(runtime, browser);
const { analyze, openReport } = browser.window.NovelightPrepublishCheck;

function codes(input) {
  const result = analyze(input);
  return result?.findings.map((f) => f.code);
}

test('the Japanese ruby and emphasis syntax passes bracket checks', () => {
  const findings = codes({
    title: '序章',
    content: '「こんにちは」\n『また会おう』\n｜月光《げっこう》と《《強調》》'
  });
  assert.equal(findings.length, 0);
});

test('empty title and body are only advisory; invalid input fails closed', () => {
  assert.deepEqual(Array.from(codes({ title: ' ', content: ' \n ' })), [
    'empty-title',
    'empty-body'
  ]);
  assert.equal(analyze({ title: {}, content: '本文' }), null);
  assert.equal(analyze({ title: '', content: null }), null);
});

test('unmatched open/close brackets report source line without manuscript excerpts', () => {
  const a = analyze({
    title: '序章',
    content: '第一行\n「開いたまま\n閉じない'
  }).findings.find((f) => f.code === 'unmatched-open');
  assert.equal(a.line, 2);
  const b = analyze({
    title: '序章',
    content: '一行目\n不意の閉じ括弧」'
  }).findings.find((f) => f.code === 'unmatched-close');
  assert.equal(b.line, 2);
  assert.ok(!JSON.stringify(b).includes('不意の'));
});

test('placeholders, title limit, body limit and long paragraphs are bounded', () => {
  const report = analyze({
    title: '長'.repeat(151),
    content: '長'.repeat(1202) + '\nTODO'
  });
  assert.ok(report.findings.some((f) => f.code === 'long-title'));
  assert.ok(
    report.findings.some((f) => f.code === 'long-paragraph' && f.line === 1)
  );
  assert.ok(
    report.findings.some((f) => f.code === 'placeholder' && f.line === 2)
  );
  assert.ok(
    codes({ title: '短い', content: 'あ'.repeat(100001) }).includes('long-body')
  );
  assert.equal(
    analyze({ title: '章', content: '」'.repeat(100000) }).findings.length,
    12
  );
});

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.textContent = '';
    this.removed = false;
    this.focused = false;
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  appendChild(node) {
    this.append(node);
  }
  addEventListener(type, fn) {
    this.listeners.set(type, fn);
  }
  removeEventListener(type) {
    this.listeners.delete(type);
  }
  remove() {
    this.removed = true;
  }
  focus() {
    this.focused = true;
  }
  fire(type, event) {
    this.listeners.get(type)?.(event);
  }
}

test('the browser report uses textContent only and closes on Escape', () => {
  const prior = new FakeNode('button');
  const doc = {
    activeElement: prior,
    body: new FakeNode('body'),
    listeners: new Map(),
    getElementById(id) {
      if (id === 'title') return { value: '<img src=x onerror=alert(1)>' };
      if (id === 'content') return { value: 'ここに本文\n「未完' };
      return null;
    },
    createElement(tag) {
      return new FakeNode(tag);
    },
    addEventListener(type, fn) {
      this.listeners.set(type, fn);
    },
    removeEventListener(type) {
      this.listeners.delete(type);
    }
  };
  assert.equal(openReport(doc), true);
  assert.equal(doc.body.children.length, 1);
  const modal = doc.body.children[0];
  assert.equal(modal.attributes.get('role'), 'dialog');
  assert.equal(modal.attributes.get('aria-modal'), 'true');
  const card = modal.children[0];
  assert.equal(card.children[1].textContent, '文章セルフチェック');
  assert.match(card.children[4].textContent, /確認候補/);
  assert.equal(card.children[5].children.length, 2);
  assert.equal(card.children[0].focused, true);
  doc.listeners.get('keydown')({ key: 'Escape' });
  assert.equal(modal.removed, true);
  assert.equal(prior.focused, true);
  assert.equal(doc.listeners.has('keydown'), false);
});

test('both editors expose check without changing save/publish or sending story text', () => {
  for (const name of ['episode-post.html', 'episode-edit.html']) {
    const page = readFileSync(resolve(name), 'utf8');
    assert.match(
      page,
      /novelight-prepublish-check\.js"><\/script>\s*<script src="novelight-author-draft\.js"/u
    );
    assert.match(page, /<textarea id="content" maxlength="100000"/u);
  }
  assert.match(draftRuntime, /check\.textContent = '文章チェック'/u);
  assert.match(draftRuntime, /NovelightPrepublishCheck\.openReport\(\)/u);
  assert.match(draftRuntime, /check\.type = 'button'/u);
  assert.doesNotMatch(
    runtime,
    /\b(fetch|XMLHttpRequest|sendBeacon|localStorage)\s*\(/u
  );
  assert.doesNotMatch(runtime, /\binnerHTML\s*=/u);
  assert.doesNotMatch(runtime, /addEventListener\('submit'/u);
  assert.match(runtime, /item\.textContent\s*=/u);
  assert.match(runtime, /finding\.line === null/u);
});
