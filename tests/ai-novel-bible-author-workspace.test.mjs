import assert from 'node:assert/strict';
import test from 'node:test';

import '../novelight-ai-bible-author-workspace.js';
import '../novelight-ai-bible-owner-outline.js';

const { render, toSections, localReviewSummary, storyIndex, sortStoryEntries } =
  globalThis.NovelightAiBibleAuthorWorkspace;

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
    return (
      this._textContent +
      this.children.map((child) => child.textContent).join('')
    );
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
        suggestions: [
          {
            payload: {
              summary: '後に真相が明らかになる',
              evidence: '机に鍵があった'
            }
          }
        ]
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
  assert.deepEqual(
    sections.map((item) => item.title),
    [
      '登場人物',
      '世界観・場所',
      '伏線',
      '出来事・時系列',
      '人物関係',
      'プロット・その他'
    ]
  );
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
  assert.equal(
    nodes(target, 'input')[0].attributes['aria-label'],
    '作品カルテ内を検索'
  );
  assert.equal(
    nodes(target, 'p').some(
      (node) => node.attributes['aria-live'] === 'polite'
    ),
    true
  );
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
  assert.match(target.textContent, /絞り込み結果：2件/);
  assert.equal(payload.facts[0].suggestions.length, 1);
  input.value = '';
  input.listeners.get('input')();
  assert.equal(
    cards.every((card) => !card.hidden),
    true
  );
});

test('missing groups or oversized private strings fail closed and clear previous owner data', () => {
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload: fixture() }), true);
  assert.match(target.textContent, /非公開の国の歴史/);
  assert.equal(
    render({ target, payload: { characters: [], notes: [], facts: null } }),
    false
  );
  assert.equal(target.hidden, true);
  assert.equal(target.textContent, '');
  const bad = fixture();
  bad.facts[0].suggestions[0].payload.evidence = 'x'.repeat(161);
  assert.equal(render({ target, payload: bad }), false);
  assert.equal(target.textContent, '');
});

test('an empty, valid Bible displays section-specific empty states', () => {
  const target = new FakeElement('div', doc);
  assert.equal(
    render({ target, payload: { characters: [], notes: [], facts: [] } }),
    true
  );
  assert.equal(nodes(target, 'section').length, 6);
  assert.equal(nodes(target, 'article').length, 0);
  assert.equal(target.textContent.match(/登録情報はありません/g).length, 8);
  assert.match(target.textContent, /登録情報：0件/);
});

test('author status filter keeps pending candidates separate from author canon', () => {
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload: fixture() }), true);
  const status = nodes(target, 'select')[0];
  const cards = nodes(target, 'article');
  assert.equal(
    status.attributes['aria-label'],
    '作品カルテの確認状態で絞り込み'
  );
  status.value = 'review';
  status.listeners.get('change')();
  assert.equal(cards.filter((card) => !card.hidden).length, 2);
  assert.match(target.textContent, /絞り込み結果：2件/);
  status.value = 'author';
  status.listeners.get('change')();
  assert.equal(cards.filter((card) => !card.hidden).length, 4);
  assert.equal(target.hidden, false);
});

test('offline review flags overlaps and distinct duplicate names without implying an AI verdict', () => {
  const payload = fixture();
  payload.characters.push({ name: '蒼', aliases: ['青い鍵の持ち主'] });
  payload.facts[1].suggestions.push({
    payload: { summary: '夏の夜', evidence: '夏の夜' }
  });
  payload.facts[1].confirmed.push({
    payload: { summary: '春の朝', evidence: '' }
  });
  const result = localReviewSummary(payload);
  assert.equal(result.pending, 2);
  assert.deepEqual(
    result.checks.map((entry) => entry.title),
    ['人物名・別名の重複', '確定設定との重複候補', '複数の確定記録']
  );
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  assert.match(target.textContent, /機械的な重複の確認のみ行います/);
  assert.match(target.textContent, /AI候補：2件・要確認項目：3件/);
  assert.equal(nodes(target, 'aside').length, 2);
  assert.deepEqual(
    payload.facts[1].confirmed.map((row) => row.payload.summary),
    ['春の朝', '春の朝']
  );
});

test('duplicate aliases within one character are not mistaken for separate people', () => {
  const payload = fixture();
  payload.characters[0].aliases.push('凛');
  const result = localReviewSummary(payload);
  assert.deepEqual(result.checks, []);
});

test('source metadata is labeled as an ID and never mistaken for a chapter number', () => {
  const payload = fixture();
  payload.facts[0].suggestions[0].sourceEpisodeId = 734;
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  assert.match(target.textContent, /参照エピソードID：734/);
  assert.doesNotMatch(target.textContent, /第734話/);
  payload.facts[0].suggestions[0].sourceEpisodeId = -1;
  assert.equal(render({ target, payload }), false);
  assert.equal(target.hidden, true);
  assert.equal(target.textContent, '');
});

test('story index groups foreshadowing, timeline and events without inventing story order', () => {
  const payload = fixture();
  payload.facts.push({
    kind: 'timeline',
    key: '帰還',
    confirmed: [
      { sourceEpisodeId: 90, payload: { summary: '王都に戻る', evidence: '' } }
    ],
    suggestions: []
  });
  payload.facts[0].suggestions[0].sourceEpisodeId = 901;
  payload.facts[1].confirmed[0].sourceEpisodeId = 101;
  const grouped = storyIndex(payload);
  assert.equal(grouped.foreshadowing.length, 1);
  assert.equal(grouped.events.length, 2);
  assert.deepEqual(grouped.foreshadowing[0].sourceEpisodeIds, [901]);
  assert.equal(
    grouped.events.find((item) => item.key === '帰還').kind,
    'timeline'
  );
  const ordered = sortStoryEntries(grouped.events, 'source-id');
  assert.deepEqual(
    ordered.map((entry) => entry.key),
    ['帰還', '出発']
  );
  assert.deepEqual(
    grouped.events.map((entry) => entry.key),
    ['出発', '帰還']
  );
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  assert.match(
    target.textContent,
    /ID順は話数順・物語内の時系列順ではありません/
  );
  assert.doesNotMatch(target.textContent, /第901話/);
  const sort = nodes(target, 'select')[2];
  sort.value = 'source-id';
  sort.listeners.get('change')();
  const groups = nodes(target, 'aside');
  assert.equal(groups.length, 2);
  assert.match(target.textContent, /参照エピソードID：901/);
});

test('matching exact headings only suggests possible cross-category links', () => {
  const payload = fixture();
  payload.facts.push({
    kind: 'event',
    key: ' 青い鍵 ',
    confirmed: [],
    suggestions: []
  });
  const index = storyIndex(payload);
  assert.equal(index.foreshadowing[0].titleMatch, true);
  assert.equal(
    index.events.find((entry) => entry.key.trim() === '青い鍵').titleMatch,
    true
  );
  assert.equal(
    index.events.find((entry) => entry.key === '出発').titleMatch,
    false
  );
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  assert.match(target.textContent, /同じ見出しの別区分あり（関連性は未判定）/);
});

test('category and status filters combine locally and hide irrelevant empty panels', () => {
  const payload = fixture();
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  const selects = nodes(target, 'select');
  const status = selects[0];
  const category = selects[1];
  const cards = nodes(target, 'article');
  category.value = 'foreshadowing';
  category.listeners.get('change')();
  assert.equal(cards.filter((card) => !card.hidden).length, 1);
  assert.equal(
    nodes(target, 'section').filter((panel) => !panel.hidden).length,
    1
  );
  status.value = 'author';
  status.listeners.get('change')();
  assert.equal(cards.filter((card) => !card.hidden).length, 0);
  assert.match(target.textContent, /絞り込み結果：0件/);
  status.value = 'review';
  status.listeners.get('change')();
  assert.equal(cards.filter((card) => !card.hidden).length, 1);
  category.value = 'events';
  category.listeners.get('change')();
  assert.equal(cards.filter((card) => !card.hidden).length, 0);
  status.value = 'author';
  status.listeners.get('change')();
  assert.equal(cards.filter((card) => !card.hidden).length, 1);
  assert.equal(payload.facts[0].suggestions.length, 1);
});

test('offline checks identify missing AI evidence and distinct confirmed statements with same source', () => {
  const payload = fixture();
  payload.facts[0].suggestions[0].payload.evidence = '';
  payload.facts[1].confirmed[0].sourceEpisodeId = 91;
  payload.facts[1].confirmed.push({
    sourceEpisodeId: 91,
    payload: { summary: '翌朝', evidence: '' }
  });
  const result = localReviewSummary(payload);
  assert.deepEqual(
    result.checks.map((entry) => entry.title),
    ['AI候補の根拠未登録', '複数の確定記録', '同一出典の異なる確定記述']
  );
  assert.equal(payload.facts[1].confirmed[0].payload.summary, '春の朝');
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  assert.match(target.textContent, /同じ出典IDに複数の異なる記述/);
  assert.match(target.textContent, /設定矛盾と断定するものではありません/);
});

test('story index uses text nodes for untrusted facts and rejects invalid source IDs', () => {
  const payload = fixture();
  payload.facts[0].key = '<svg onload=alert(1)>';
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  assert.equal(nodes(target, 'svg').length, 0);
  assert.match(target.textContent, /<svg onload=alert\(1\)>/);
  payload.facts[0].suggestions[0].sourceEpisodeId = '999';
  assert.equal(render({ target, payload }), false);
  assert.equal(target.hidden, true);
  assert.equal(target.textContent, '');
});

test('invalid story index input never escapes fail-closed validation', () => {
  const payload = fixture();
  payload.facts[1].confirmed[0].payload.summary = 1234;
  assert.equal(storyIndex(payload), null);
  assert.equal(localReviewSummary(payload), null);
});

test('unrecognized inherited fact kind fails closed rather than throwing', () => {
  const payload = fixture();
  payload.facts[0].kind = '__proto__';
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload: fixture() }), true);
  assert.equal(toSections(payload), null);
  assert.equal(storyIndex(payload), null);
  assert.equal(render({ target, payload }), false);
  assert.equal(target.hidden, true);
  assert.equal(target.textContent, '');
});

test('review totals include items omitted from the capped notice list', () => {
  const payload = { characters: [], notes: [], facts: [] };
  for (let i = 0; i < 22; i += 1) {
    payload.characters.push({ name: '人物 ' + i, aliases: ['共通の別名'] });
  }
  for (let i = 0; i < 80; i += 1) {
    payload.facts.push({
      kind: 'event',
      key: '出来事 ' + i,
      confirmed: [{ payload: { summary: '確定', evidence: '' } }],
      suggestions: [{ payload: { summary: '候補', evidence: '出典テキスト' } }]
    });
  }
  // 160 fact records stay within the owner API's 200-record cap:
  // 21 duplicate-alias notices + 80 overlaps = 101 review notices.
  const review = localReviewSummary(payload);
  assert.equal(review.checks.length, 100);
  assert.equal(review.remaining, 1);
  assert.equal(review.pending, 80);
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  assert.match(target.textContent, /AI候補：80件・要確認項目：101件/);
  assert.match(target.textContent, /ほか 1 件の確認ポイントがあります/);
});

test('author can mark local review items without writing or accepting facts', () => {
  const payload = fixture();
  payload.characters.push({ name: '蒼', aliases: ['青い鍵の持ち主'] });
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  const reviewButtons = nodes(target, 'button').filter(
    (item) => item.className === 'novelight-ai-workspace-reviewed-button'
  );
  const button = reviewButtons[0];
  assert.equal(reviewButtons.length, 1);
  assert.equal(button.attributes['aria-pressed'], 'false');
  assert.match(
    target.textContent,
    /この画面だけの確認済み：0\/1件（保存されません）/
  );
  button.listeners.get('click')();
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.match(
    target.textContent,
    /この画面だけの確認済み：1\/1件（保存されません）/
  );
  button.listeners.get('click')();
  assert.equal(button.attributes['aria-pressed'], 'false');
  assert.match(
    target.textContent,
    /この画面だけの確認済み：0\/1件（保存されません）/
  );
  button.listeners.get('click')();
  assert.equal(render({ target, payload }), true);
  assert.match(
    target.textContent,
    /この画面だけの確認済み：0\/1件（保存されません）/
  );
  assert.equal(payload.facts[0].suggestions.length, 1);
  assert.equal(payload.characters[1].name, '蒼');
});

test('malformed fact records fail closed without reading stale author data', () => {
  const target = new FakeElement('div', doc);
  for (const record of [
    null,
    undefined,
    [],
    { payload: null },
    { payload: [] }
  ]) {
    const good = fixture();
    assert.equal(render({ target, payload: good }), true);
    assert.match(target.textContent, /非公開の国の歴史/);
    const malformed = fixture();
    malformed.facts[0].suggestions = [record];
    assert.equal(toSections(malformed), null);
    assert.equal(render({ target, payload: malformed }), false);
    assert.equal(target.hidden, true);
    assert.equal(target.textContent, '');
  }
});

test('legacy fact objects lacking optional excerpts do not throw during review checklist', () => {
  const payload = fixture();
  payload.facts[0].suggestions[0].payload = {};
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  assert.match(target.textContent, /AI候補の根拠未登録/);
  assert.equal(localReviewSummary(payload).pending, 1);
});

test('preview refuses excessive records and incomplete grouped API fields', () => {
  const payload = fixture();
  const item = {
    sourceEpisodeId: 7,
    payload: { summary: 'メモ', evidence: '' }
  };
  payload.facts[1].confirmed = Array.from({ length: 201 }, () => item);
  assert.equal(toSections(payload), null);
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), false);
  assert.equal(target.hidden, true);
  payload.facts[1].confirmed = [item];
  delete payload.facts[1].suggestions;
  assert.equal(toSections(payload), null);
});

// Offline author workflow: trusted owner-only chapter rows enrich references,
// but cannot turn an episode database ID into a fictional chronology.
test('private chapter navigation joins real episode ordinals and offers focus actions', () => {
  const payload = fixture();
  payload.novelId = 23;
  payload.aiGenerated = false;
  payload.facts[0].suggestions[0].sourceEpisodeId = 900;
  payload.facts[1].confirmed[0].sourceEpisodeId = 100;
  const outlineRows = [
    {
      episode_id: 100,
      episode_number: 7,
      episode_title: '出発',
      episode_status: 'published',
      chapter_id: 400,
      chapter_title: '第一章',
      chapter_position: 2
    },
    {
      episode_id: 900,
      episode_number: 2,
      episode_title: '鍵',
      episode_status: 'draft',
      chapter_id: 300,
      chapter_title: 'プロローグ',
      chapter_position: 1
    }
  ];
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload, outlineRows }), true);
  assert.match(target.textContent, /プロローグ／第2話（エピソードID：900）/);
  assert.match(target.textContent, /第一章／第7話（エピソードID：100）/);
  assert.match(target.textContent, /物語内の時系列順ではありません/);
  const order = nodes(target, 'select')[2];
  assert.equal(order.children.length, 3);
  order.value = 'episode-number';
  order.listeners.get('change')();
  const focus = nodes(target, 'button').find(
    (button) =>
      button.className === 'novelight-ai-workspace-story-focus' &&
      button.attributes['aria-label'].includes('青い鍵')
  );
  assert.ok(focus);
  focus.listeners.get('click')();
  assert.equal(nodes(target, 'input')[0].value, '青い鍵');
  assert.equal(nodes(target, 'select')[1].value, 'foreshadowing');
  const visible = nodes(target, 'article').filter((card) => !card.hidden);
  assert.equal(visible.length, 1);
  assert.match(visible[0].textContent, /青い鍵/);
  assert.match(target.textContent, /絞り込み結果：1件/);
  assert.equal(payload.facts[0].suggestions.length, 1);
});

test('offline outline mismatch, missing projector and wrong novel clear private view', () => {
  const payload = fixture();
  payload.novelId = 23;
  payload.aiGenerated = false;
  payload.facts[0].suggestions[0].sourceEpisodeId = 900;
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  const incompleteOutline = [
    {
      episode_id: 900,
      episode_number: 2,
      episode_title: '鍵',
      episode_status: 'draft',
      chapter_id: null,
      chapter_title: null,
      chapter_position: null
    }
  ];
  // A valid owner-provided outline works when it covers every cited ID.
  assert.equal(
    render({ target, payload, outlineRows: incompleteOutline }),
    true
  );
  assert.match(target.textContent, /第2話/);
  assert.equal(
    render({
      target,
      payload,
      outlineRows: [{ ...incompleteOutline[0], episode_id: 901 }]
    }),
    false
  );
  assert.equal(target.hidden, true);
  assert.equal(target.textContent, '');
  assert.equal(
    render({
      target,
      payload: { ...payload, novelId: null },
      outlineRows: incompleteOutline
    }),
    false
  );
  assert.equal(target.hidden, true);
  assert.equal(target.textContent, '');
  assert.equal(render({ target, payload, outlineRows: [] }), false);
  assert.equal(target.textContent, '');
});

test('story index focus locates source cards without any RPC, write or external navigation', () => {
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload: fixture() }), true);
  const focus = nodes(target, 'button').find(
    (button) =>
      button.className === 'novelight-ai-workspace-story-focus' &&
      button.attributes['aria-label'].includes('出発')
  );
  assert.ok(focus);
  focus.listeners.get('click')();
  assert.equal(nodes(target, 'input')[0].value, '出発');
  assert.equal(nodes(target, 'select')[1].value, 'events');
  assert.equal(
    nodes(target, 'article').filter((item) => !item.hidden).length,
    1
  );
  assert.match(target.textContent, /絞り込み結果：1件/);
});
