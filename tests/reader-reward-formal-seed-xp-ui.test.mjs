import test from 'node:test';
import assert from 'node:assert/strict';
await import('../assets/formal-scout-reward-ui.js');

const ui = globalThis.NovelightFormalScoutReward;
const SEED_ID = '33333333-3333-4333-8333-333333333333';
const sample = {
  serverVerified: true,
  formalEnabled: true,
  wallet: {
    availablePoints: 0,
    exchangeEligiblePoints: 0,
    heldPoints: 0
  },
  account: { level: 30 },
  scout: { badges: [], seeds: [] },
  seedEvidence: {
    status: 'formal_reader_seed_evidence_review_only',
    readyForPublicRelease: false,
    historicalXpBackfillAllowed: false,
    mayIssueXp: false,
    independentlyVerifiedEntireLedger: false,
    moreSeedsAvailable: true,
    items: [
      {
        seedId: SEED_ID,
        grade: 'GOLD',
        workTitle: '夜の読書',
        growth: 3,
        novaPrediction: false,
        expiresAt: '2026-11-20T00:00:00.000Z',
        updatedAt: '2026-11-15T00:00:00.000Z',
        recordedCreditedXp: 120,
        missingXpEvidenceEvents: 1,
        stages: [
          {
            stage: 'growth_2',
            occurredAt: '2026-11-15T00:00:00.000Z',
            ledgerCreditedXp: 120,
            creditLedgerVerified: true,
            claimedDeltaMatchesLedger: false
          },
          {
            stage: 'growth_3',
            occurredAt: '2026-11-15T00:00:00.000Z',
            ledgerCreditedXp: null,
            creditLedgerVerified: false,
            claimedDeltaMatchesLedger: false
          }
        ]
      }
    ]
  }
};

class Node {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = '';
    this.textContent = '';
    this.children = [];
    this.listeners = {};
    this.attributes = {};
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
  addEventListener(key, callback) {
    this.listeners[key] = callback;
  }
  fire(event) {
    return this.listeners[event]?.({ preventDefault() {} });
  }
}
globalThis.document = { createElement: (tag) => new Node(tag) };
const walk = (root) => [root, ...root.children.flatMap(walk)];
const content = (root) =>
  walk(root)
    .map((n) => n.textContent)
    .join(' ');
async function render(data) {
  const root = new Node('main');
  const panel = ui.createRewardReaderPanel({
    root,
    fetchSnapshot: async () => data
  });
  await panel.reload();
  walk(root)
    .find(
      (element) =>
        element.tagName === 'button' && element.textContent === '発掘・称号'
    )
    .fire('click');
  return { root, panel };
}

test('server-verified formal reader sees actual ledger XP and explicitly unverified historical stages', async () => {
  const { root, panel } = await render(sample);
  const rendered = content(root);
  assert.match(rendered, /LIGHT SEED 発掘段階・実記録XP/);
  assert.match(rendered, /夜の読書/);
  assert.match(rendered, /台帳で確認できたXP 120/);
  assert.match(rendered, /\+2 Rank/);
  assert.match(rendered, /\+3 Rank/);
  assert.match(rendered, /XP記録未確認/);
  assert.match(rendered, /未記録XPは遡及付与しません/);
  assert.match(rendered, /理論値と記録に差あり/);
  assert.match(rendered, /残りの履歴は別途照合/);
  assert.doesNotMatch(rendered, /300 XP|rankAtSeed|highestRankSeen/);
  assert.equal(panel.getSnapshot().seedEvidence.items.length, 1);
  assert.equal(walk(root).filter((n) => n.tagName === 'button').length, 4);
});

test('unverified or disabled snapshot hides all actual seed XP and work titles', async () => {
  for (const input of [
    { ...sample, serverVerified: false },
    { ...sample, formalEnabled: false },
    { ...sample, seedEvidence: null }
  ]) {
    const { root, panel } = await render(input);
    assert.equal(panel.getSnapshot().seedEvidence, null);
    assert.doesNotMatch(content(root), /夜の読書|台帳で確認できたXP 120/);
  }
});

test('malformed, truncated, forged or internally inconsistent evidence fails closed', async () => {
  const original = sample.seedEvidence;
  const seed = original.items[0];
  const bad = [
    { ...original, mayIssueXp: true },
    { ...original, readyForPublicRelease: true },
    { ...original, status: 'ready' },
    { ...original, items: [{ ...seed, seedId: 'unknown' }] },
    { ...original, items: [seed, seed] },
    { ...original, items: [{ ...seed, recordedCreditedXp: 300 }] },
    { ...original, items: [{ ...seed, missingXpEvidenceEvents: 0 }] },
    {
      ...original,
      items: [
        {
          ...seed,
          stages: [
            {
              ...seed.stages[0],
              creditLedgerVerified: false
            }
          ]
        }
      ]
    },
    {
      ...original,
      items: [
        {
          ...seed,
          stages: [{ ...seed.stages[0], stage: 'growth_6' }]
        }
      ]
    }
  ];
  for (const seedEvidence of bad) {
    const snapshot = ui.normalizeSnapshot({ ...sample, seedEvidence });
    assert.equal(snapshot.seedEvidence, null);
  }
});
