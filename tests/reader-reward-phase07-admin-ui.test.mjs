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

test('authorized operator can inspect formal Point totals and audited records without a budget cap', async () => {
  const root = new Element('main');
  let reads = 0;
  const panel =
    globalThis.NovelightFormalRewardAdmin.createFormalRewardAdminPanel({
      root,
      authorized: true,
      loadQueue: async () => ({ status: 'queue_ready', items: [] }),
      loadRewardOverview: async () => {
        reads++;
        return {
          status: 'reward_overview_ready',
          pointsPerYen: 10,
          issuedMonth: 250,
          issuedTotal: 1400,
          readMonth: 150,
          commentMonth: 100,
          giftSpentNet: 300,
          aiSpentNet: 20,
          eligibleAvailable: 1200,
          eligibleReserved: 0,
          pendingExchangePoints: 0,
          pendingExchangeCount: 0,
          recent: [
            {
              eventId: one.operationId,
              userId: one.userId,
              kind: 'formal_read_reward',
              points: 5,
              status: 'confirmed',
              occurredAt: '2026-11-12T00:00:00.000Z'
            }
          ]
        };
      },
      onResolve: async () => {
        throw Error('VIEW_MUST_NOT_WRITE');
      }
    });
  await panel.refresh();
  assert.ok(reads >= 1);
  assert.equal(match(root, 'SCOUT REWARD / 発行・利用記録').length, 1);
  assert.equal(match(root, '今月の新規発行').length, 1);
  assert.equal(match(root, '250 pt（25円相当）').length, 1);
  assert.equal(
    match(root, '月次固定予算は設定しません。今月は日本時間の暦月です。')
      .length,
    1
  );
  assert.equal(match(root, 'formal_read_reward：5 pt').length, 1);
  assert.equal(match(root, 'ユーザーID：' + one.userId).length, 1);
  const hidden = new Element('main');
  let unsafeLoads = 0;
  const closed =
    globalThis.NovelightFormalRewardAdmin.createFormalRewardAdminPanel({
      root: hidden,
      authorized: false,
      loadQueue: async () => {
        unsafeLoads++;
        return { status: 'queue_ready', items: [] };
      },
      loadRewardOverview: async () => {
        unsafeLoads++;
        throw Error('DENIED');
      },
      onResolve: async () => {}
    });
  await closed.refresh();
  assert.equal(unsafeLoads, 0);
  assert.equal(match(hidden, '今月の新規発行').length, 0);
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
      adminGiftQueueAvailable: true,
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

test('formal admin page defaults to read-only monitoring', async () => {
  await import('../assets/formal-scout-reward-transport.js');
  await import('../assets/formal-scout-reward-mount.js');
  await import('../assets/formal-scout-reward-page.js');
  const calls = [];
  const root = new Element('main');
  const makePage = globalThis.NovelightFormalRewardPage.prepareFormalRewardPage;
  const page = makePage({
    adminRoot: root,
    authorized: true,
    adminEndpoint: '/api/formal-reward-admin',
    getAccessToken: async () => 'synthetic-admin',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () =>
          url.includes('view=new_readers')
            ? {
                ok: true,
                status: 'new_reader_summary_ready',
                totalRegistered: 7,
                initialized: 6,
                partial: 1
              }
            : { ok: true, status: 'not_configured' }
      };
    }
  });
  assert.equal(calls.length, 0);
  const panel = page.admin();
  const result = await panel.refresh();
  assert.equal(result.status, 'queue_not_connected');
  assert.equal(match(root, '正式版以降の新規読者').length, 1);
  assert.equal(match(root, '根拠を確認').length, 1);
  assert.equal(match(root, '返金・回収を照合').length, 0);
  assert.equal(match(root, '事業者への引渡しを照合').length, 0);
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((x) => x.options.method === 'GET'));
  assert.ok(calls.every((x) => x.options.cache === 'no-store'));
  assert.ok(calls.every((x) => x.options.credentials === 'same-origin'));
  assert.ok(
    calls.every(
      (x) => x.options.headers.Authorization === 'Bearer synthetic-admin'
    )
  );
  assert.ok(calls.every((x) => x.url.includes('?view=')));
  assert.ok(calls.every((x) => !x.url.includes('view=refunds')));
});

test('gift queue inspection keeps settlement controls OFF', async () => {
  const root = new Element('main');
  const calls = [];
  const page = globalThis.NovelightFormalRewardPage.prepareFormalRewardPage({
    adminRoot: root,
    authorized: true,
    adminEndpoint: '/api/formal-reward-admin',
    adminGiftQueueAvailable: true,
    getAccessToken: async () => 'synthetic-admin',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => {
          if (!url.includes('?'))
            return { ok: true, status: 'queue_ready', items: [one] };
          if (url.includes('view=refunds'))
            return {
              ok: true,
              status: 'refund_candidates_ready',
              items: [{ ...one, phase: 'committed' }]
            };
          return { ok: true, status: 'unavailable' };
        }
      };
    }
  });
  const panel = page.admin();
  assert.equal((await panel.refresh()).status, 'queue_ready');
  assert.equal(match(root, '30,000 pt（3,000円相当）').length, 1);
  assert.equal(match(root, '返金・回収を照合').length, 0);
  assert.equal(match(root, '事業者への引渡しを照合').length, 0);
  assert.ok(calls.some((x) => x.url === '/api/formal-reward-admin'));
  assert.ok(calls.some((x) => x.url.includes('view=refunds')));
  assert.ok(calls.every((x) => x.options.method === 'GET'));
});

test('settlement actions require a separately enabled gift queue', () => {
  let touched = 0;
  const page = globalThis.NovelightFormalRewardPage.prepareFormalRewardPage({
    adminRoot: new Element('main'),
    authorized: true,
    adminEndpoint: '/api/formal-reward-admin',
    adminSettlementActionsAvailable: true,
    getAccessToken: async () => 'synthetic-admin',
    fetchImpl: async () => {
      touched++;
      throw Error('NO_NETWORK');
    }
  });
  assert.throws(page.admin, /Gift settlement requires an approved gift queue/);
  assert.equal(touched, 0);
});

test('reader page is read-only despite an enabled server snapshot', async () => {
  await import('../assets/formal-scout-reward-transport.js');
  await import('../assets/formal-scout-reward-ui.js');
  await import('../assets/formal-scout-reward-client.js');
  await import('../assets/formal-scout-reward-mount.js');
  await import('../assets/formal-scout-reward-page.js');
  const root = new Element('main');
  const calls = [];
  const page = globalThis.NovelightFormalRewardPage.prepareFormalRewardPage({
    readerRoot: root,
    readerEndpoint: '/api/formal-reward-reader',
    getAccessToken: async () => 'synthetic-reader',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          serverVerified: true,
          formalEnabled: true,
          exchangeEnabled: true,
          giftProviderReady: true,
          account: { level: 48, progressXp: 40, requiredXp: 400 },
          wallet: {
            availablePoints: 45000,
            exchangeEligiblePoints: 38000,
            heldPoints: 0
          },
          history: [],
          aiFeatures: [
            {
              id: 'preview_feature',
              name: '未公開AI',
              approved: true,
              pricePoints: 200
            }
          ]
        })
      };
    }
  });
  assert.equal(calls.length, 0);
  const panel = page.reader();
  await panel.reload();
  assert.equal(match(root, 'Lv.48').length, 1);
  match(root, 'デジタルギフト交換')[0].fire('click');
  const submit = match(root, '交換を申請する')[0];
  assert.equal(submit.disabled, true);
  const form = flatten(root).find((node) => node.tagName === 'form');
  await form.fire('submit');
  const aiTab = match(root, 'AIに使う')[0];
  aiTab.fire('click');
  const use = match(root, '利用する')[0];
  assert.equal(use.disabled, true);
  await use.fire('click');
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((call) => call.options.method === 'GET'));
  assert.ok(calls.every((call) => call.options.cache === 'no-store'));
  assert.ok(calls.every((call) => !call.options.body));
});

test('Point actions require an operation ID provider', () => {
  const prepare = globalThis.NovelightFormalRewardPage.prepareFormalRewardPage;
  let calls = 0;
  for (const enabled of [
    { readerExchangeAvailable: true },
    { readerAiPointAvailable: true }
  ]) {
    assert.throws(
      () =>
        prepare({
          readerRoot: new Element('main'),
          readerEndpoint: '/api/formal-reward-reader',
          getAccessToken: async () => 'synthetic-reader',
          fetchImpl: async () => {
            calls++;
          },
          ...enabled
        }),
      /Reader Point actions require operation UUIDs/
    );
  }
  assert.equal(calls, 0);
});

test('new reader status needs no Point operation ID', async () => {
  const root = new Element('main');
  const calls = [];
  const page = globalThis.NovelightFormalRewardPage.prepareFormalRewardPage({
    readerRoot: root,
    newReaderOnboardingAvailable: true,
    readerEndpoint: '/api/formal-reward-reader',
    getAccessToken: async () => 'synthetic-reader',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () =>
          url.includes('view=new_reader')
            ? { ok: true, status: 'new_reader_ready_for_initialization' }
            : {
                serverVerified: true,
                formalEnabled: false,
                wallet: { availablePoints: 0 },
                account: { level: 1, progressXp: 0, requiredXp: 50 }
              }
      };
    }
  });
  const panel = page.reader();
  await panel.reload();
  await tick();
  assert.ok(calls.some((call) => call.url.includes('view=new_reader')));
  assert.ok(calls.every((call) => call.options.method === 'GET'));
  const onboard = match(root, '正式スカウトを利用開始')[0];
  assert.equal(onboard.disabled, false);
  assert.equal(match(root, '正式登録が可能です。').length, 1);
});
