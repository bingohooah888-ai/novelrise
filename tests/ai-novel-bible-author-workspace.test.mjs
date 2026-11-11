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
  assert.equal(nodes(target, 'aside').length, 3);
  assert.match(target.textContent, /確定設定とAI候補を見比べる/);
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

test('author can filter all six categories and reset local filters without writes', () => {
  const payload = fixture();
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  const selects = nodes(target, 'select');
  const categories = selects[1];
  assert.equal(categories.children.length, 7);
  categories.value = 'relationships';
  categories.listeners.get('change')();
  const cards = nodes(target, 'article');
  assert.equal(cards.filter((item) => !item.hidden).length, 1);
  assert.match(target.textContent, /絞り込み結果：1件/);
  const input = nodes(target, 'input')[0];
  input.value = '存在しない';
  input.listeners.get('input')();
  assert.match(target.textContent, /絞り込み結果：0件/);
  const reset = nodes(target, 'button').find(
    (item) => item.className === 'novelight-ai-workspace-clear-filters'
  );
  assert.ok(reset);
  reset.listeners.get('click')();
  assert.equal(input.value, '');
  assert.equal(categories.value, 'all');
  assert.match(target.textContent, /登録情報：6件/);
  assert.equal(cards.filter((item) => !item.hidden).length, 6);
});

test('private owner outline enables chapter-based reverse lookup for all fact kinds', () => {
  const payload = fixture();
  payload.novelId = 23;
  payload.aiGenerated = false;
  payload.facts[0].suggestions[0].sourceEpisodeId = 900;
  payload.facts[1].confirmed[0].sourceEpisodeId = 100;
  payload.facts.push({
    kind: 'world',
    key: '魔法の図書館',
    confirmed: [
      {
        sourceEpisodeId: 900,
        payload: { summary: '王都の図書館', evidence: '' }
      }
    ],
    suggestions: []
  });
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
  assert.match(target.textContent, /話数から設定を探す/);
  assert.match(target.textContent, /プロローグ／第2話／参照エピソードID：900/);
  assert.match(target.textContent, /第一章／第7話／参照エピソードID：100/);
  const episodes = nodes(target, 'select').find(
    (item) => item.className === 'novelight-ai-workspace-episode-filter'
  );
  assert.equal(episodes.children.length, 3);
  assert.equal(episodes.children[1].value, '900');
  episodes.value = '900';
  episodes.listeners.get('change')();
  const cards = nodes(target, 'article');
  assert.equal(cards.filter((item) => !item.hidden).length, 2);
  assert.match(target.textContent, /絞り込み結果：2件/);
  const status = nodes(target, 'select')[0];
  status.value = 'author';
  status.listeners.get('change')();
  assert.equal(cards.filter((item) => !item.hidden).length, 1);
  assert.match(
    cards.filter((item) => !item.hidden)[0].textContent,
    /魔法の図書館/
  );
  const focus = nodes(target, 'button').find(
    (item) =>
      item.className === 'novelight-ai-workspace-story-focus' &&
      item.attributes['aria-label'].includes('青い鍵')
  );
  focus.listeners.get('click')();
  assert.equal(episodes.value, 'all');
  assert.equal(status.value, 'all');
  const reset = nodes(target, 'button').find(
    (item) => item.className === 'novelight-ai-workspace-clear-filters'
  );
  reset.listeners.get('click')();
  assert.equal(episodes.value, 'all');
  assert.equal(cards.filter((item) => !item.hidden).length, 7);
  assert.equal(
    payload.facts.at(-1).confirmed[0].payload.summary,
    '王都の図書館'
  );
});

test('owner outline missing world-fact source fails closed instead of leaking old data', () => {
  const payload = fixture();
  payload.novelId = 23;
  payload.aiGenerated = false;
  payload.facts.push({
    kind: 'location',
    key: '未掲載の場所',
    confirmed: [
      { sourceEpisodeId: 999, payload: { summary: '秘密の場所', evidence: '' } }
    ],
    suggestions: []
  });
  const target = new FakeElement('div', doc);
  assert.equal(
    render({ target, payload: { characters: [], notes: [], facts: [] } }),
    true
  );
  const outlineRows = [
    {
      episode_id: 100,
      episode_number: 7,
      episode_title: '出発',
      episode_status: 'published',
      chapter_id: null,
      chapter_title: null,
      chapter_position: null
    }
  ];
  assert.equal(render({ target, payload, outlineRows }), false);
  assert.equal(target.hidden, true);
  assert.equal(target.textContent, '');
});

test('confirmed settings and AI candidates compare literally without silent adoption', () => {
  const payload = fixture();
  payload.facts[1].suggestions = [
    {
      sourceEpisodeId: 8,
      payload: {
        summary: '<script>作者へ提案</script>',
        evidence: '出典の文章'
      }
    }
  ];
  const before = JSON.stringify(payload);
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  const comparison = nodes(target, 'aside').find(
    (item) => item.className === 'novelight-ai-workspace-comparisons'
  );
  assert.ok(comparison);
  assert.match(comparison.textContent, /作者が確定した設定（1件）/);
  assert.match(comparison.textContent, /AI抽出候補・未確定（1件）/);
  assert.match(comparison.textContent, /春の朝/);
  assert.match(comparison.textContent, /<script>作者へ提案<\/script>/);
  assert.match(comparison.textContent, /引用根拠：出典の文章/);
  assert.equal(nodes(comparison, 'script').length, 0);
  assert.equal(nodes(comparison, 'button').length, 0);
  assert.equal(JSON.stringify(payload), before);
});

test('character dossiers combine exact registry names, aliases and author notes', () => {
  const payload = fixture();
  payload.novelId = 23;
  payload.aiGenerated = false;
  payload.notes.push({
    type: 'character',
    title: '凛',
    body: '実際の人物設定ノート'
  });
  payload.facts.push(
    {
      kind: 'character',
      key: '凛',
      confirmed: [
        {
          sourceEpisodeId: 100,
          payload: { summary: '一人称は私', evidence: '' }
        }
      ],
      suggestions: []
    },
    {
      kind: 'character',
      key: '青い鍵の持ち主',
      confirmed: [],
      suggestions: [
        {
          sourceEpisodeId: 900,
          payload: { summary: '鍵の使い手らしい', evidence: '手に鍵を持った' }
        }
      ]
    }
  );
  const outlineRows = [
    {
      episode_id: 100,
      episode_number: 9,
      episode_title: '出会い',
      episode_status: 'published',
      chapter_id: 1,
      chapter_title: '第一章',
      chapter_position: 1
    },
    {
      episode_id: 900,
      episode_number: 2,
      episode_title: '序章',
      episode_status: 'draft',
      chapter_id: 2,
      chapter_title: 'プロローグ',
      chapter_position: 2
    }
  ];
  const before = JSON.stringify(payload);
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload, outlineRows }), true);
  const profiles = nodes(target, 'div').find(
    (item) => item.className === 'novelight-ai-workspace-character-profiles'
  );
  assert.ok(profiles);
  assert.match(profiles.textContent, /登場人物別に設定を確認/);
  assert.match(profiles.textContent, /凛／作者確定 1件・AI未確定 1件/);
  assert.match(profiles.textContent, /登録済みの別名：青い鍵の持ち主/);
  assert.match(profiles.textContent, /作者の創作ノート（非公開）：凛/);
  assert.match(profiles.textContent, /プロローグ／第2話（ID：900）/);
  assert.match(profiles.textContent, /第一章／第9話（ID：100）/);
  assert.ok(
    profiles.textContent.indexOf('プロローグ／第2話（ID：900）') <
      profiles.textContent.indexOf('第一章／第9話（ID：100）')
  );
  assert.match(profiles.textContent, /実際の登場回数とは限りません/);
  const choose = nodes(profiles, 'button').find(
    (item) => item.className === 'novelight-ai-workspace-character-focus'
  );
  assert.ok(choose);
  choose.listeners.get('click')();
  const selected = nodes(target, 'select').find(
    (item) => item.className === 'novelight-ai-workspace-character-filter'
  );
  assert.equal(selected.value, '0');
  assert.equal(nodes(target, 'select')[1].value, 'characters');
  const visible = nodes(target, 'article').filter((item) => !item.hidden);
  assert.equal(visible.length, 4);
  assert.match(target.textContent, /絞り込み結果：4件/);
  assert.equal(JSON.stringify(payload), before);
});

test('unmatched character headings remain visible without invented identity', () => {
  const payload = fixture();
  payload.facts.push({
    kind: 'character',
    key: '凛の口調',
    confirmed: [{ payload: { summary: '丁寧な話し方', evidence: '' } }],
    suggestions: []
  });
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  const profiles = nodes(target, 'div').find(
    (item) => item.className === 'novelight-ai-workspace-character-profiles'
  );
  assert.match(
    profiles.textContent,
    /人物名・別名と見出しが一致しない設定（1項目）/
  );
  assert.match(profiles.textContent, /設定が誤りとは限りません/);
  const jump = nodes(profiles, 'button').find(
    (item) =>
      item.className === 'novelight-ai-workspace-character-unmatched-focus'
  );
  jump.listeners.get('click')();
  const visible = nodes(target, 'article').filter((item) => !item.hidden);
  assert.equal(visible.length, 1);
  assert.match(visible[0].textContent, /凛の口調/);
  const selected = nodes(target, 'select').find(
    (item) => item.className === 'novelight-ai-workspace-character-filter'
  );
  assert.equal(selected.value, 'all');
  const reset = nodes(target, 'button').find(
    (item) => item.className === 'novelight-ai-workspace-clear-filters'
  );
  reset.listeners.get('click')();
  assert.equal(visible[0].hidden, false);
  assert.equal(
    nodes(target, 'article').filter((item) => !item.hidden).length,
    7
  );
});

test('character select and story focus can be combined without stale filters', () => {
  const payload = fixture();
  payload.characters.push({ name: '蒼', aliases: ['もう一人の剣士'] });
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  const selection = nodes(target, 'select').find(
    (item) => item.className === 'novelight-ai-workspace-character-filter'
  );
  selection.value = '1';
  selection.listeners.get('change')();
  assert.equal(
    nodes(target, 'article').filter((item) => !item.hidden).length,
    1
  );
  const focus = nodes(target, 'button').find(
    (item) =>
      item.className === 'novelight-ai-workspace-story-focus' &&
      item.attributes['aria-label'].includes('青い鍵')
  );
  focus.listeners.get('click')();
  assert.equal(selection.value, 'all');
  assert.equal(nodes(target, 'select')[1].value, 'foreshadowing');
  assert.equal(
    nodes(target, 'article').filter((item) => !item.hidden).length,
    1
  );
  assert.match(target.textContent, /絞り込み結果：1件/);
});

test('source records group same headings by episode origin without claiming revisions', () => {
  const payload = fixture();
  payload.novelId = 23;
  payload.aiGenerated = false;
  payload.facts[1].confirmed[0].sourceEpisodeId = 900;
  payload.facts[1].suggestions.push({
    sourceEpisodeId: 100,
    payload: { summary: '旅立ちは夜だったかも', evidence: '門を夜に出た' }
  });
  const before = JSON.stringify(payload);
  const outlineRows = [
    {
      episode_id: 900,
      episode_number: 9,
      episode_title: '春',
      episode_status: 'draft',
      chapter_id: 2,
      chapter_title: '第二章',
      chapter_position: 2
    },
    {
      episode_id: 100,
      episode_number: 2,
      episode_title: '夜',
      episode_status: 'published',
      chapter_id: 1,
      chapter_title: '第一章',
      chapter_position: 1
    }
  ];
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload, outlineRows }), true);
  const history = nodes(target, 'div').find(
    (item) => item.className === 'novelight-ai-workspace-source-records'
  );
  assert.ok(history);
  assert.match(history.textContent, /同じ見出しの出典別記録（1項目）/);
  assert.match(history.textContent, /編集履歴や物語内の時間順ではありません/);
  assert.match(history.textContent, /出発／作者確定 1件・AI未確定 1件/);
  assert.ok(
    history.textContent.indexOf('第一章／第2話（ID：100）') <
      history.textContent.indexOf('第二章／第9話（ID：900）')
  );
  assert.match(history.textContent, /AI抽出候補・未確定／旅立ちは夜だったかも/);
  assert.match(history.textContent, /引用根拠：門を夜に出た/);
  const focus = nodes(history, 'button')[0];
  focus.listeners.get('click')();
  assert.equal(nodes(target, 'input')[0].value, '出発');
  assert.equal(nodes(target, 'select')[1].value, 'events');
  assert.equal(
    nodes(target, 'article').filter((item) => !item.hidden).length,
    2
  );

  // One shortcut per authorized source episode, after the existing
  // heading-wide search. No draft title or manuscript navigation is exposed.
  const sourceActions = nodes(history, 'button').filter(
    (button) =>
      button.className === 'novelight-ai-workspace-source-episode-focus'
  );
  assert.equal(sourceActions.length, 2);
  const chapters = nodes(target, 'select').find(
    (node) => node.className === 'novelight-ai-workspace-chapter-filter'
  );
  const episodes = nodes(target, 'select').find(
    (node) => node.className === 'novelight-ai-workspace-episode-filter'
  );
  assert.ok(chapters);
  assert.ok(episodes);
  sourceActions[0].listeners.get('click')();
  assert.equal(chapters.value, '1');
  assert.equal(episodes.value, '100');
  assert.deepEqual(
    episodes.children.map((node) => node.value),
    ['all', '100']
  );
  assert.equal(
    nodes(target, 'article').filter((item) => !item.hidden).length,
    1
  );
  assert.match(
    nodes(target, 'article').find((item) => !item.hidden).textContent,
    /AI抽出候補・未確定/
  );
  sourceActions[1].listeners.get('click')();
  assert.equal(chapters.value, '2');
  assert.equal(episodes.value, '900');
  assert.deepEqual(
    episodes.children.map((node) => node.value),
    ['all', '900']
  );
  assert.equal(
    nodes(target, 'article').filter((item) => !item.hidden).length,
    1
  );
  assert.match(
    nodes(target, 'article').find((item) => !item.hidden).textContent,
    /作者が確定した設定/
  );
  // The original heading-wide search still resets chapter and episode.
  focus.listeners.get('click')();
  assert.equal(chapters.value, 'all');
  assert.equal(episodes.value, 'all');
  assert.equal(episodes.children.length, 3);
  assert.equal(
    nodes(target, 'article').filter((item) => !item.hidden).length,
    2
  );
  assert.equal(JSON.stringify(payload), before);
});

test('source-only records sort IDs without asserting episode or fictional time order', () => {
  const payload = fixture();
  payload.facts[1].confirmed[0].sourceEpisodeId = 900;
  payload.facts[1].confirmed.push({
    sourceEpisodeId: 100,
    payload: { summary: '昼に出た', evidence: '' }
  });
  payload.facts[1].suggestions.push({
    payload: { summary: '出典がまだない', evidence: '' }
  });
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  const history = nodes(target, 'div').find(
    (item) => item.className === 'novelight-ai-workspace-source-records'
  );
  assert.match(
    history.textContent,
    /実際の話数順・物語内の時間順ではありません/
  );
  assert.ok(
    history.textContent.indexOf('参照エピソードID：100') <
      history.textContent.indexOf('参照エピソードID：900')
  );
  assert.ok(
    history.textContent.indexOf('参照エピソードID：900') <
      history.textContent.indexOf('出典未登録')
  );
  assert.match(history.textContent, /AI抽出候補・未確定／出典がまだない/);
});

test('author plot and world notes link only same-category exact headings', () => {
  const payload = fixture();
  payload.notes.push({
    type: 'world',
    title: '青い鍵',
    body: '<script>非公開の伏線メモ</script>'
  });
  payload.facts.push(
    {
      kind: 'world',
      key: '王都',
      confirmed: [{ payload: { summary: '巨大な都市', evidence: '' } }],
      suggestions: []
    },
    {
      kind: 'other',
      key: '第一幕',
      confirmed: [],
      suggestions: [{ payload: { summary: '旅の始まり', evidence: '' } }]
    }
  );
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  const links = nodes(target, 'div').find(
    (item) => item.className === 'novelight-ai-workspace-note-links'
  );
  assert.ok(links);
  assert.match(links.textContent, /創作ノートから設定を確認/);
  assert.match(
    links.textContent,
    /ノート「王都」／同じ見出しの登録設定：1項目/
  );
  assert.match(
    links.textContent,
    /ノート「第一幕」／同じ見出しの登録設定：1項目/
  );
  assert.match(
    links.textContent,
    /ノート「青い鍵」／同じ見出しの登録設定：0項目/
  );
  assert.equal(nodes(links, 'button').length, 2);
  assert.equal(nodes(links, 'script').length, 0);
  assert.match(target.textContent, /<script>非公開の伏線メモ<\/script>/);
  const buttons = nodes(links, 'button');
  buttons[0].listeners.get('click')();
  assert.equal(nodes(target, 'select')[1].value, 'world');
  assert.equal(nodes(target, 'input')[0].value, '王都');
  assert.equal(
    nodes(target, 'article').filter((item) => !item.hidden).length,
    2
  );
  buttons[1].listeners.get('click')();
  assert.equal(nodes(target, 'select')[1].value, 'plot');
  assert.equal(nodes(target, 'input')[0].value, '第一幕');
  assert.equal(
    nodes(target, 'article').filter((item) => !item.hidden).length,
    2
  );
});

test('pending foreshadowing review button never assumes a recovered clue', () => {
  const payload = fixture();
  const before = JSON.stringify(payload);
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  const story = nodes(target, 'aside').find(
    (item) => item.className === 'novelight-ai-workspace-story-index'
  );
  assert.match(story.textContent, /AI伏線候補の確認待ち：1件（1項目）/);
  assert.match(
    story.textContent,
    /回収済み・未回収はこのデータから判定していません/
  );
  const focus = nodes(story, 'button').find(
    (item) => item.className === 'novelight-ai-workspace-clue-review-focus'
  );
  assert.ok(focus);
  focus.listeners.get('click')();
  assert.equal(nodes(target, 'select')[0].value, 'review');
  assert.equal(nodes(target, 'select')[1].value, 'foreshadowing');
  assert.equal(
    nodes(target, 'article').filter((item) => !item.hidden).length,
    1
  );
  assert.match(target.textContent, /絞り込み結果：1件/);
  assert.equal(JSON.stringify(payload), before);
  payload.facts[0].suggestions = [];
  assert.equal(render({ target, payload }), true);
  const empty = nodes(target, 'aside').find(
    (item) => item.className === 'novelight-ai-workspace-story-index'
  );
  assert.match(empty.textContent, /AI伏線候補の確認待ち：0件（0項目）/);
  assert.equal(
    nodes(empty, 'button').filter(
      (item) => item.className === 'novelight-ai-workspace-clue-review-focus'
    ).length,
    0
  );
});

test('author selects chapter then episode to find only matching private settings', () => {
  const payload = {
    novelId: 23,
    aiGenerated: false,
    characters: [],
    notes: [
      { type: 'plot', title: '非公開構想', body: 'PRIVATE_UNSOURCED_NOTE' }
    ],
    facts: [
      {
        kind: 'event',
        key: '第一章の事件',
        confirmed: [
          {
            sourceEpisodeId: 100,
            payload: { summary: 'PRIVATE_CHAPTER_A', evidence: '' }
          }
        ],
        suggestions: []
      },
      {
        kind: 'foreshadowing',
        key: '第二章の鍵',
        confirmed: [],
        suggestions: [
          {
            sourceEpisodeId: 900,
            payload: { summary: 'PRIVATE_CHAPTER_B', evidence: '' }
          }
        ]
      },
      {
        kind: 'event',
        key: '章未設定の出来事',
        confirmed: [
          {
            sourceEpisodeId: 700,
            payload: { summary: 'PRIVATE_NO_CHAPTER', evidence: '' }
          }
        ],
        suggestions: []
      }
    ]
  };
  const snapshot = JSON.stringify(payload);
  const outlineRows = [
    {
      episode_id: 900,
      episode_number: 2,
      episode_title: '下書き',
      episode_status: 'draft',
      chapter_id: 2,
      chapter_title: '第二章',
      chapter_position: 2
    },
    {
      episode_id: 700,
      episode_number: 4,
      episode_title: '未分類',
      episode_status: 'published',
      chapter_id: null,
      chapter_title: null,
      chapter_position: null
    },
    {
      episode_id: 100,
      episode_number: 1,
      episode_title: '第一話',
      episode_status: 'published',
      chapter_id: 1,
      chapter_title: '第一章',
      chapter_position: 1
    }
  ];
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload, outlineRows }), true);
  const chapters = nodes(target, 'select').find(
    (node) => node.className === 'novelight-ai-workspace-chapter-filter'
  );
  const episodes = nodes(target, 'select').find(
    (node) => node.className === 'novelight-ai-workspace-episode-filter'
  );
  assert.ok(chapters);
  assert.ok(
    nodes(target, 'select').indexOf(chapters) <
      nodes(target, 'select').indexOf(episodes),
    'chapter selector must precede its dependent episode selector'
  );
  assert.deepEqual(
    chapters.children.map((node) => node.value),
    ['all', '1', '2', 'none']
  );
  assert.deepEqual(
    episodes.children.map((node) => node.value),
    ['all', '100', '900', '700']
  );
  assert.match(chapters.textContent, /第一章/);
  assert.match(chapters.textContent, /第二章/);
  const cards = nodes(target, 'article');
  const visible = () => cards.filter((card) => !card.hidden);
  assert.equal(visible().length, 4);

  chapters.value = '2';
  chapters.listeners.get('change')();
  assert.deepEqual(
    episodes.children.map((node) => node.value),
    ['all', '900']
  );
  assert.equal(visible().length, 1);
  assert.match(visible()[0].textContent, /PRIVATE_CHAPTER_B/);
  assert.doesNotMatch(
    visible()[0].textContent,
    /PRIVATE_CHAPTER_A|PRIVATE_UNSOURCED_NOTE/
  );

  episodes.value = '900';
  episodes.listeners.get('change')();
  assert.equal(visible().length, 1);
  assert.match(visible()[0].textContent, /第二章／第2話/);

  chapters.value = '1';
  chapters.listeners.get('change')();
  assert.equal(episodes.value, 'all');
  assert.deepEqual(
    episodes.children.map((node) => node.value),
    ['all', '100']
  );
  assert.equal(visible().length, 1);
  assert.match(visible()[0].textContent, /PRIVATE_CHAPTER_A/);

  chapters.value = 'none';
  chapters.listeners.get('change')();
  assert.deepEqual(
    episodes.children.map((node) => node.value),
    ['all', '700']
  );
  assert.equal(visible().length, 1);
  assert.match(visible()[0].textContent, /PRIVATE_NO_CHAPTER/);

  const reset = nodes(target, 'button').find(
    (button) => button.className === 'novelight-ai-workspace-clear-filters'
  );
  reset.listeners.get('click')();
  assert.equal(chapters.value, 'all');
  assert.equal(episodes.value, 'all');
  assert.deepEqual(
    episodes.children.map((node) => node.value),
    ['all', '100', '900', '700']
  );
  assert.equal(visible().length, 4);
  assert.equal(JSON.stringify(payload), snapshot);
});

test('chapter search is unavailable without trusted outline and invalid refresh clears private view', () => {
  const payload = {
    novelId: 23,
    aiGenerated: false,
    characters: [],
    notes: [],
    facts: [
      {
        kind: 'world',
        key: '世界の秘密',
        confirmed: [
          {
            sourceEpisodeId: 100,
            payload: { summary: 'PRIVATE_WORLD_CANON', evidence: '' }
          }
        ],
        suggestions: []
      }
    ]
  };
  const target = new FakeElement('div', doc);
  assert.equal(render({ target, payload }), true);
  assert.equal(
    nodes(target, 'select').some(
      (node) => node.className === 'novelight-ai-workspace-chapter-filter'
    ),
    false
  );
  assert.equal(
    render({
      target,
      payload,
      outlineRows: [
        {
          episode_id: 100,
          episode_number: 1,
          episode_title: '第一話',
          episode_status: 'published',
          chapter_id: 1,
          chapter_title: '第一章',
          chapter_position: 1
        }
      ]
    }),
    true
  );
  assert.equal(
    nodes(target, 'select').some(
      (node) => node.className === 'novelight-ai-workspace-chapter-filter'
    ),
    true
  );
  assert.equal(render({ target, payload, outlineRows: [] }), false);
  assert.equal(target.hidden, true);
  assert.equal(target.textContent, '');
});
