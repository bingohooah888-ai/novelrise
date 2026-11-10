import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { setImmediate } from 'node:timers';
await import('../assets/formal-scout-reward-ui.js');

const ui = globalThis.NovelightFormalScoutReward;
const base = {
  serverVerified: true,
  formalEnabled: false,
  exchangeEnabled: false,
  giftProviderReady: false,
  account: {
    level: 72,
    progressXp: 320,
    requiredXp: 400,
    earnedXpInPeriod: 164
  },
  wallet: {
    availablePoints: 38500,
    exchangeEligiblePoints: 31500,
    heldPoints: 1200
  },
  history: [{ kind: 'read', points: 6, status: 'confirmed' }],
  aiFeatures: [
    { id: 'one', name: '作品分析', pricePoints: null, approved: false }
  ]
};

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.listeners = {};
    this.attributes = {};
    this.disabled = false;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = [...nodes];
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  addEventListener(key, listener) {
    this.listeners[key] = listener;
  }
  fire(name, event = {}) {
    return this.listeners[name]?.({ preventDefault() {}, ...event });
  }
}
globalThis.document = { createElement: (tag) => new FakeElement(tag) };

function flatten(node) {
  return [node, ...node.children.flatMap(flatten)];
}
function text(node) {
  return flatten(node)
    .map((n) => n.textContent || '')
    .join(' ');
}
function byTag(root, tag) {
  return flatten(root).filter((n) => n.tagName === tag);
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('MASTER exchange policy stays 10 pt = ¥1, external floor 30000 Point', () => {
  assert.equal(ui.POINTS_PER_YEN, 10);
  assert.equal(ui.MIN_EXCHANGE_POINTS, 30000);
});

test('unverified wallet cannot display usable balances or activate reward actions', async () => {
  const snapshot = ui.normalizeSnapshot({
    ...base,
    serverVerified: false,
    formalEnabled: true,
    exchangeEnabled: true,
    giftProviderReady: true
  });
  assert.equal(snapshot.available, null);
  assert.equal(snapshot.exchangeEligible, null);
  assert.equal(snapshot.formalEnabled, false);
  assert.equal(snapshot.history.length, 0);
  const root = new FakeElement('main');
  let exchangeCalls = 0;
  const panel = ui.createRewardReaderPanel({
    root,
    fetchSnapshot: async () => ({ ...base, serverVerified: false }),
    onExchange: async () => {
      exchangeCalls++;
    }
  });
  await panel.reload();
  byTag(root, 'button')
    .find((n) => n.textContent === 'デジタルギフト交換')
    .fire('click');
  const submit = byTag(root, 'button').find(
    (n) => n.textContent === '交換受付準備中'
  );
  assert.equal(submit.disabled, true);
  await byTag(root, 'form')[0].fire('submit');
  assert.equal(exchangeCalls, 0);
});

test('reader sees formal Level, separate spendable/exchange-eligible balance and 30-day XP rule', async () => {
  const root = new FakeElement('main');
  const panel = ui.createRewardReaderPanel({
    root,
    fetchSnapshot: async () => base
  });
  await panel.reload();
  assert.match(text(root), /Lv\.72/);
  assert.match(text(root), /38,500 pt/);
  assert.match(text(root), /31,500 pt/);
  assert.match(text(root), /200 XP/);
  assert.match(text(root), /正式版の準備中/);
});

test('exchange estimate validates 30000 threshold and eligible balance; no live request without launch', async () => {
  const root = new FakeElement('main');
  const panel = ui.createRewardReaderPanel({
    root,
    fetchSnapshot: async () => base
  });
  await panel.reload();
  byTag(root, 'button')
    .find((n) => n.textContent === 'デジタルギフト交換')
    .fire('click');
  const input = byTag(root, 'input')[0];
  const form = byTag(root, 'form')[0];
  input.value = '29999';
  input.fire('input');
  assert.match(text(form), /最低 30,000 pt/);
  input.value = '30000';
  input.fire('input');
  assert.match(text(form), /3,000 円相当/);
  input.value = '35000';
  input.fire('input');
  assert.match(text(form), /交換可能残高を超えています/);
  assert.equal(byTag(form, 'button')[0].disabled, true);
});

test('approved formal backend callbacks receive only the amount, not client supplied balance', async () => {
  let count = 0;
  const root = new FakeElement('main');
  const approved = {
    ...base,
    formalEnabled: true,
    exchangeEnabled: true,
    giftProviderReady: true
  };
  const panel = ui.createRewardReaderPanel({
    root,
    fetchSnapshot: async () => approved,
    onExchange: async (input) => {
      count++;
      assert.deepEqual(input, { amountPoints: 30000 });
      return { status: 'request_received' };
    }
  });
  await panel.reload();
  byTag(root, 'button')
    .find((n) => n.textContent === 'デジタルギフト交換')
    .fire('click');
  const input = byTag(root, 'input')[0];
  input.value = '30000';
  input.fire('input');
  await byTag(root, 'form')[0].fire('submit');
  await tick();
  assert.equal(count, 1);
});

test('AI uses Point directly, but price-unapproved or formal-disabled features cannot invoke AI', async () => {
  const root = new FakeElement('main');
  let count = 0;
  const panel = ui.createRewardReaderPanel({
    root,
    fetchSnapshot: async () => base,
    onAiUse: async () => {
      count++;
    }
  });
  await panel.reload();
  byTag(root, 'button')
    .find((n) => n.textContent === 'AIに使う')
    .fire('click');
  assert.match(text(root), /AI Creditへの交換は不要/);
  assert.match(text(root), /料金未確定/);
  const use = byTag(root, 'button').find((n) => n.textContent === '利用する');
  assert.equal(use.disabled, true);
  await use.fire('click');
  assert.equal(count, 0);
});

test('unpublished preview stays a static local fixture with no live integration', () => {
  const html = readFileSync(
    new URL('../docs/drafts/SCOUT-REWARD-READER-PREVIEW.html', import.meta.url),
    'utf8'
  );
  assert.match(html, /未公開・開発用プレビュー/);
  assert.match(html, /formalEnabled: false/);
  assert.match(html, /exchangeEnabled: false/);
  assert.match(html, /giftProviderReady: false/);
  assert.doesNotMatch(
    html,
    /fetch\s*\(|service_role|supabase\.createClient|api\/reader-reward/
  );
});
