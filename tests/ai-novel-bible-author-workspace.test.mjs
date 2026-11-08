import assert from 'node:assert/strict';
import test from 'node:test';

import '../novelight-ai-bible-author-workspace.js';

const { render, toSections } = globalThis.NovelightAiBibleAuthorWorkspace;

class FakeElement {
  constructor(tagName = 'div', ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this._textContent = '';
    this.hidden = false;
    this.listeners = new Map();
    this.attributes = {};
    this.value = '';
  }
  set textContent(text) {
    this._textContent = String(text);
    this.children = [];
  }
  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join('');
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }
}
const doc = {
  createElement(name) {
    return new FakeElement(name, doc);
  }
};
function nodes(root, tagName) {
  const found = [];
  function walk(node) {
    if (node.tagName === tagName.toUpperCase()) found.push(node);
    node.children.forEach(walk);
  }
  walk(root);
  return found;
}
function fixture() {
  return {
    characters: [{ name: '凛', aliases: ['青い鍵の持ち主'] }],
    notes: [
      { type: 'world', title: '王都', body: '非公開の国の歴史' },
      { type: 'plot', title: '第一幕', body: '主人公が出発する' }
    ],
    facts: [
      {
        kind: 'foreshadowing',
        key: '青い鍵',
        confirmed: [],
        suggestions: [{
          payload: { summary: '後に真相が明らかになる', evidence: '机に鍵があった' }
        }]
      },
      {
        kind: 'event',
        key: '出発',
        confirmed: [{ payload: { summary: '春の朝', evidence: '' } }],
        suggestions: []
      },
      { kind: 'relationship', key: '凛と蒼', confirmed: [], suggestions: [] }
    ]
  };
}

test('groups existing author canon and AI suggestions without accepting them', () => {
  const sections = toSections(fixture());
  assert.deepEqual(sections.map((item) => item.title), [
    '登場人物', '世界観・場所', '伏線',
    '出来事・時系列', '人物関係', 'プロット・その他'
  ]);
  assert.equal(sections[0].items[0].title, '凛');
  assert.equal(sections[1].items[0].detail, '非公開の国の歴史');
  assert.equal(sections[2].items[0].status, 'AI抽出候補・未確定');
  assert.equal(sections[3].items[0].status, '作者が確定した設定');
  assert.equal(sections[4].items[0].status, '登録情報（確認状態未指定）');
});

test('renders searchable, accessible private cards using text nodes only', () => {
  const target = new FakeElement('div', doc);
  const payload = fixture();
  payload.characters[0].name = '<img src=x onerror=alert(1)>';
  assert.equal(render({ target, payload }), true);
  assert.equal(target.hidden, false);
  assert.equal(nodes(target, 'script').length, 0);
  assert.equal(nodes(target, 'img').length, 0);
  assert.match(target.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(target.textContent, /AI抽出候補・未確定/);
  assert.match(target.textContent, /自動的に採用されません/);
  assert.equal(nodes(target, 'section').length, 6);
  assert.equal(nodes(target, 'input')[0].attributes['aria-label'], '作品カルテ内を検索');
  assert.equal(nodes(target, 'p').some((node) => node.attributes['aria-live'] === 'polite'), true);
});

test('local search filters the cards but never mutates the source data', () => {
  const payload = fixture();
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  const input = nodes(target, 'input')[0];
  const cards = nodes(target, 'article');
  assert.equal(cards.length, 6);
  input.value = '青い鍵';
  input.listeners.get('input')();
  assert.equal(cards.filter((card) => !card.hidden).length, 2);
  assert.match(target.textContent, /検索結果：2件/);
  assert.equal(payload.facts[0].suggestions.length, 1);
  input.value = '';
  input.listeners.get('input')();
  assert.equal(cards.every((card) => !card.hidden), true);
});

test('missing groups or oversized private strings fail closed and clear previous owner data', () => {
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload: fixture() }), true);
  assert.match(target.textContent, /非公開の国の歴史/);
  assert.equal(render({ target, payload: { characters: [], notes: [], facts: null } }), false);
  assert.equal(target.hidden, true);
  assert.equal(target.textContent, '');
  const bad = fixture();
  bad.facts[0].suggestions[0].payload.evidence = 'x'.repeat(161);
  assert.equal(render({ target, payload: bad }), false);
  assert.equal(target.textContent, '');
});

test('an empty, valid Bible displays section-specific empty states', () => {
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload: { characters: [], notes: [], facts: [] } }), true);
  assert.equal(nodes(target, 'section').length, 6);
  assert.equal(nodes(target, 'article').length, 0);
  assert.equal(target.textContent.match(/登録情報はありません/g).length, 6);
  assert.match(target.textContent, /登録情報：0件/);
});
