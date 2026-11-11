import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
await import('../assets/formal-scout-reward-admin.js');

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.textContent = '';
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
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  fire(name) {
    return this.listeners[name]?.({ preventDefault() {} });
  }
}
globalThis.document = { createElement: (tag) => new Element(tag) };
function flatten(n) {
  return [n, ...n.children.flatMap(flatten)];
}
function match(root, text) {
  return flatten(root).filter((n) => n.textContent === text);
}
const tick = () => new Promise((resolve) => process.nextTick(resolve));
const one = {
  operationId: '00000000-0000-4000-8000-000000000311',
  userId: '00000000-0000-4000-8000-000000000301',
  amountPoints: 30000,
  phase: 'reserved'
};

test('admin queue remains hidden if application host is not authorized', async () => {
  const root = new Element('main');
  let calls = 0;
  const panel =
    globalThis.NovelightFormalRewardAdmin.createFormalRewardAdminPanel({
      root,
      authorized: false,
      loadQueue: async () => {
        calls++;
        return { status: 'queue_ready', items: [one] };
      },
      onResolve: async () => {
        calls++;
      }
    });
  const result = await panel.refresh();
  assert.equal(result.status, 'admin_not_verified');
  assert.equal(calls, 0);
  assert.equal(
    match(root, '管理者の本人確認と正式版の利用開始が必要です。').length,
    1
  );
});

test('admin panel opens reserved gift queue and delegates fulfillment to injected trusted handler', async () => {
  const root = new Element('main');
  let pending = [one];
  let resolved = 0;
  const panel =
    globalThis.NovelightFormalRewardAdmin.createFormalRewardAdminPanel({
      root,
      authorized: true,
      loadQueue: async () => ({ status: 'queue_ready', items: pending }),
      onResolve: async (input) => {
        assert.deepEqual(input, {
          operationId: one.operationId,
          action: 'confirm_fulfilled'
        });
        resolved++;
        pending = [];
        return { status: 'committed' };
      }
    });
  await panel.refresh();
  assert.equal(match(root, '30,000 pt（3,000円相当）').length, 1);
  const button = match(root, '事業者への引渡しを照合')[0];
  await button.fire('click');
  await tick();
  assert.equal(resolved, 1);
  assert.equal(match(root, '現在、未完了の交換申請はありません。').length, 1);
});

test('admin panel does not claim a settlement without verified provider response', async () => {
  const root = new Element('main');
  const panel =
    globalThis.NovelightFormalRewardAdmin.createFormalRewardAdminPanel({
      root,
      authorized: true,
      loadQueue: async () => ({ status: 'queue_ready', items: [one] }),
      onResolve: async () => ({ status: 'fulfillment_evidence_missing' })
    });
  await panel.refresh();
  await match(root, '事業者への引渡しを照合')[0].fire('click');
  assert.equal(
    match(root, 'サーバー側の引渡し証拠が未確認のため、処理を保留しました。')
      .length,
    1
  );
  assert.equal(match(root, '事業者への引渡しを照合').length, 1);
});

test('admin preview remains isolated from actual site and payment systems', () => {
  const html = readFileSync(
    new URL('../docs/drafts/SCOUT-REWARD-ADMIN-PREVIEW.html', import.meta.url),
    'utf8'
  );
  assert.match(html, /非公開・管理者向け交換申請一覧/);
  assert.doesNotMatch(
    html,
    /supabase\.createClient|fetch\(|api\/formal|stripe|service_role/i
  );
});

test('reader and admin preview mounts reuse the real draft UI-to-host binding contract', async () => {
  await import('../assets/formal-scout-reward-ui.js');
  await import('../assets/formal-scout-reward-client.js');
  await import('../assets/formal-scout-reward-mount.js');
  const reader = new Element('main');
  let readerCalls = 0;
  const view = globalThis.NovelightFormalRewardMount.mountFormalReaderReward({
    root: reader,
    nextOperationId: () => '00000000-0000-4000-8000-000000000311',
    request: async ({ method }) => {
      readerCalls++;
      if (method !== 'GET') throw new Error('OFFLINE_PREVIEW_FORBIDS_WRITES');
      return {
        serverVerified: true,
        formalEnabled: false,
        account: { level: 52, progressXp: 100, requiredXp: 400 },
        wallet: {
          availablePoints: 2000,
          exchangeEligiblePoints: 500,
          heldPoints: 0
        },
        history: [],
        aiFeatures: []
      };
    }
  });
  await view.reload();
  assert.ok(readerCalls >= 1);
  assert.equal(
    flatten(reader).some((n) => n.textContent === 'Lv.52'),
    true
  );
  const admin = new Element('main');
  const adminPanel =
    globalThis.NovelightFormalRewardMount.mountFormalRewardAdmin({
      root: admin,
      authorized: true,
      request: async ({ method }) =>
        method === 'GET'
          ? { status: 'queue_ready', items: [one] }
          : { status: 'fulfillment_evidence_missing' }
    });
  await adminPanel.refresh();
  assert.equal(match(admin, '30,000 pt（3,000円相当）').length, 1);
});

test('administrator can inspect committed gift refund candidates; no refund without server proof', async () => {
  const root = new Element('main');
  let candidates = [{ ...one, phase: 'committed' }];
  let resolved = 0;
  const panel =
    globalThis.NovelightFormalRewardAdmin.createFormalRewardAdminPanel({
      root,
      authorized: true,
      loadQueue: async () => ({ status: 'queue_ready', items: [] }),
      loadRefunds: async () => ({
        status: 'refund_candidates_ready',
        items: candidates
      }),
      onResolve: async ({ operationId, action }) => {
        assert.equal(operationId, one.operationId);
        assert.equal(action, 'refund_recovered');
        resolved++;
        return { status: 'refund_evidence_missing' };
      }
    });
  await panel.refresh();
  assert.equal(match(root, '確定済み取引の返金照合').length, 1);
  await match(root, '返金・回収を照合')[0].fire('click');
  assert.equal(resolved, 1);
  assert.equal(
    match(
      root,
      '独立した返金・回収証跡が未確認のため、返金を実施していません。'
    ).length,
    1
  );
  candidates = [];
  await panel.refresh();
  assert.equal(match(root, '返金・回収を照合').length, 0);
});
