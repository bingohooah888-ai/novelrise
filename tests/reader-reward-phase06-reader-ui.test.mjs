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

test('formal Scout Rank uses verified Level and exact 10 official bands', async () => {
  const bands = [
    [1, 'NOCTIS'], [10, 'NOCTIS'],
    [11, 'VESPER'], [30, 'UMBRA'],
    [31, 'ASTRA'], [50, 'LUCENT'],
    [60, 'AURELIS'], [70, 'CELESTIA'],
    [71, 'EMPYREAN'], [90, 'SERAPH'],
    [91, 'LUMINARIS'], [100, 'LUMINARIS']
  ];
  for (const [level, expected] of bands) {
    assert.equal(ui.rankAtLevel(level), expected);
  }
  for (const invalid of [0, 101, -1, 1.1, null, undefined, '72']) {
    assert.equal(ui.rankAtLevel(invalid), null);
  }
  assert.equal(ui.normalizeSnapshot(base).rank, 'EMPYREAN');
  assert.equal(ui.normalizeSnapshot({ ...base, serverVerified: false }).rank, null);
  const root = new FakeElement('main');
  const panel = ui.createRewardReaderPanel({
    root,
    fetchSnapshot: async () => base
  });
  await panel.reload();
  assert.match(text(root), /SCOUT RANK/);
  assert.match(text(root), /EMPYREAN/);
  const other = new FakeElement('main');
  const blocked = ui.createRewardReaderPanel({
    root: other,
    fetchSnapshot: async () => ({ ...base, serverVerified: false })
  });
  await blocked.reload();
  assert.doesNotMatch(text(other), /EMPYREAN/);
});

test('renders reader badges and SEED growth without internal Rank', async () => {
  const sample = {
    ...base,
    scout: {
      badges: [
        { id: 'reader_seed_001', name: 'SEEDBEARER',
          progress: 1, target: 1, enabled: true, earned: true },
        { id: 'reader_secret_001', name: '???',
          progress: 0, target: 5, enabled: false, earned: false }
      ],
      seeds: [
        { type: 'GOLD', workTitle: '夜の物語', growth: 2,
          novaPrediction: false },
        { type: 'BRONZE', workTitle: null, growth: 1,
          novaPrediction: true }
      ]
    }
  };
  const root = new FakeElement('main');
  const panel = ui.createRewardReaderPanel({
    root,
    fetchSnapshot: async () => sample
  });
  await panel.reload();
  byTag(root, 'button').find((b) => b.textContent === '発掘・称号').fire('click');
  assert.match(text(root), /SEEDBEARER/);
  assert.match(text(root), /読者称号 1 \/ 2 種達成/);
  assert.match(text(root), /\+2 Rank 発掘/);
  assert.match(text(root), /NOVA予見/);
  assert.match(text(root), /現在表示できない作品/);
  assert.doesNotMatch(text(root), /rank_at_seed|rankAtSeed/);
  const hidden = new FakeElement('main');
  const blocked = ui.createRewardReaderPanel({
    root: hidden,
    fetchSnapshot: async () => ({ ...sample, serverVerified: false })
  });
  await blocked.reload();
  byTag(hidden, 'button').find((b) => b.textContent === '発掘・称号').fire('click');
  assert.doesNotMatch(text(hidden), /SEEDBEARER|夜の物語/);
  assert.equal(panel.getSnapshot().scout.badges.length, 2);
  assert.equal(blocked.getSnapshot().scout, null);
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
  assert.match(text(root), /キャンセルは未発行の確認後/);
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

test('empty or failed server snapshots immediately revoke UI exchange/AI action eligibility', async () => {
  const root = new FakeElement('main');
  const authorized = {
    ...base,
    formalEnabled: true,
    exchangeEnabled: true,
    giftProviderReady: true,
    aiFeatures: [
      { id: 'analysis', name: '架空の分析', approved: true, pricePoints: 120 }
    ]
  };
  let next = authorized;
  let calls = 0;
  const panel = ui.createRewardReaderPanel({
    root,
    fetchSnapshot: async () => {
      if (next instanceof Error) throw next;
      return next;
    },
    onExchange: async () => {
      calls++;
    },
    onAiUse: async () => {
      calls++;
    }
  });
  await panel.reload();
  assert.equal(panel.getSnapshot().formalEnabled, true);
  next = null;
  await panel.reload();
  assert.equal(panel.getSnapshot().formalEnabled, false);
  assert.equal(panel.getSnapshot().available, null);
  byTag(root, 'button')
    .find((b) => b.textContent === 'デジタルギフト交換')
    .fire('click');
  assert.equal(byTag(root, 'form')[0].children.at(-1).disabled, true);
  next = new Error('OFFLINE_AUTH_REVOKED');
  await panel.reload();
  assert.equal(panel.getSnapshot().exchangeEnabled, false);
  byTag(root, 'button')
    .find((b) => b.textContent === 'AIに使う')
    .fire('click');
  const aiAction = byTag(root, 'button').find(
    (b) => b.textContent === '利用する'
  );
  assert.equal(aiAction, undefined);
  assert.equal(calls, 0);
});

test('out-of-order snapshot responses cannot re-enable expired permissions', async () => {
  const root = new FakeElement('main');
  const authorized = {
    ...base,
    formalEnabled: true,
    exchangeEnabled: true,
    giftProviderReady: true
  };
  let resolveOld;
  let count = 0;
  const panel = ui.createRewardReaderPanel({
    root,
    fetchSnapshot: () => {
      count++;
      if (count === 1) return Promise.resolve(null);
      if (count === 2)
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      return Promise.resolve({ ...authorized, serverVerified: false });
    },
    onExchange: async () => {}
  });
  const old = panel.reload();
  await panel.reload();
  resolveOld(authorized);
  await old;
  assert.equal(panel.getSnapshot().formalEnabled, false);
  assert.equal(panel.getSnapshot().available, null);
});
