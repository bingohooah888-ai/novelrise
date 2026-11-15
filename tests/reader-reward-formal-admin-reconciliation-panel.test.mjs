import test from 'node:test';
import assert from 'node:assert/strict';
await import('../assets/formal-scout-reward-admin.js');

const { createFormalAdminBindings, createFormalRewardAdminPanel } =
  globalThis.NovelightFormalRewardAdmin;

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.className = '';
    this.textContent = '';
    this.children = [];
    this.attributes = {};
    this.handlers = {};
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = [...children];
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  addEventListener(type, handler) {
    this.handlers[type] = handler;
  }
}
globalThis.document = {
  createElement: (tag) => new FakeNode(tag)
};
const root = () => new FakeNode('main');
function flatten(node) {
  return [node.textContent, ...node.children.flatMap(flatten)].join(' ');
}
function descendants(node, predicate) {
  return [
    ...(predicate(node) ? [node] : []),
    ...node.children.flatMap((child) => descendants(child, predicate))
  ];
}
const report = (status, observed) => ({
  status,
  observed,
  blockers: ['verification_is_pending'],
  readyForPublicRelease: false,
  mayWriteDb: false,
  mayIssuePoints: false
});
const reports = {
  badge_catalog: report('formal_badge_catalog_review_only', {
    total: 100,
    enabled: 58,
    theoreticalPointReward: 8350
  }),
  badge_history: report('formal_badge_history_review_only', {
    earned_badges: 30,
    legacy_unit_events: 2,
    earned_without_event: 3,
    orphan_reader_badge_events: 1
  }),
  wallet_cohort: report('formal_wallet_cohort_review_only', {
    wallet_users: 12,
    ledger_without_wallet_users: 4,
    wallet_balance_mismatch_users: 2,
    unsettled_ledger_rows: 5
  }),
  settlement_recovery: report('formal_settlement_recovery_review_only', {
    operations_total: 6,
    history_mismatch_operations: 1,
    missing_spend_operations: 1,
    missing_refund_operations: 1,
    orphan_settlement_ledger_events: 1
  })
};

test('bindings re-use precisely the four existing authorized GET views', async () => {
  const calls = [];
  const binding = createFormalAdminBindings({
    request: async (args) => {
      calls.push(args);
      return args;
    }
  });
  for (const [method, view] of [
    ['loadBadgeCatalog', 'badge_catalog'],
    ['loadBadgeHistory', 'badge_history'],
    ['loadWalletCohort', 'wallet_cohort'],
    ['loadSettlementRecovery', 'settlement_recovery']
  ]) {
    assert.equal(typeof binding[method], 'function');
    await binding[method]();
    assert.deepEqual(calls.at(-1), { method: 'GET', query: { view } });
  }
  assert.equal(typeof binding.loadQueue, 'function');
  assert.equal(typeof binding.onResolve, 'function');
  assert.equal(calls.length, 4);
});

test('admin panel displays aggregate diagnostics without new write controls', async () => {
  const calls = [];
  const callbacks = {
    loadQueue: async () => ({ status: 'queue_ready', items: [] }),
    onResolve: async () => {
      throw Error('UNAUTHORIZED_OPERATION');
    }
  };
  for (const [method, view] of [
    ['loadBadgeCatalog', 'badge_catalog'],
    ['loadBadgeHistory', 'badge_history'],
    ['loadWalletCohort', 'wallet_cohort'],
    ['loadSettlementRecovery', 'settlement_recovery']
  ]) {
    callbacks[method] = async () => {
      calls.push(view);
      return reports[view];
    };
  }
  const element = root();
  const panel = createFormalRewardAdminPanel({
    root: element,
    authorized: true,
    ...callbacks
  });
  const result = await panel.refresh();
  assert.equal(result.status, 'queue_ready');
  assert.deepEqual([...new Set(calls)].sort(), Object.keys(reports).sort());
  const text = flatten(element);
  assert.match(text, /正式報酬 \/ 公開前の整合性監査/);
  assert.match(text, /公開OFF/);
  assert.match(text, /称号定義：100/);
  assert.match(text, /旧単位イベント：2/);
  assert.match(text, /Wallet未作成：4/);
  assert.match(text, /孤立した決済Point：1/);
  assert.match(text, /未解決の確認事項：1件/);
  const audits = descendants(
    element,
    (node) => node.className === 'rr-admin-audits'
  );
  assert.equal(audits.length, 1);
  assert.equal(descendants(audits[0], (n) => n.tag === 'button').length, 0);
});

test('unverified administrator never invokes diagnostic callbacks', async () => {
  let calls = 0;
  const element = root();
  const panel = createFormalRewardAdminPanel({
    root: element,
    authorized: false,
    loadQueue: async () => {
      calls++;
      throw Error('NO_QUEUE_CALL_EXPECTED');
    },
    onResolve: async () => {
      throw Error('NO_WRITES');
    },
    loadBadgeCatalog: async () => {
      calls++;
      throw Error('NO_DB_READ_EXPECTED');
    }
  });
  const result = await panel.refresh();
  assert.equal(result.status, 'admin_not_verified');
  assert.equal(calls, 0);
  assert.match(flatten(element), /管理者の本人確認/);
});

test('unavailable, malformed and purported release-ready audits fail closed', async () => {
  const element = root();
  const panel = createFormalRewardAdminPanel({
    root: element,
    authorized: true,
    loadQueue: async () => ({ status: 'queue_ready', items: [] }),
    onResolve: async () => ({ status: 'formal_use_disabled' }),
    loadBadgeCatalog: async () => ({
      ...reports.badge_catalog,
      readyForPublicRelease: true
    }),
    loadBadgeHistory: async () => ({
      ...reports.badge_history,
      observed: { ...reports.badge_history.observed, legacy_unit_events: '2' }
    }),
    loadWalletCohort: async () => {
      throw Error('OFFLINE');
    },
    loadSettlementRecovery: async () => null
  });
  const result = await panel.refresh();
  assert.equal(result.status, 'queue_ready');
  const audits = descendants(
    element,
    (node) => node.className === 'rr-admin-audits'
  );
  assert.equal(audits.length, 1);
  const text = flatten(audits[0]);
  assert.equal((text.match(/監査結果が不完全・未検証です/g) || []).length, 4);
  assert.doesNotMatch(text, /称号定義：100/);
  assert.equal(descendants(audits[0], (n) => n.tag === 'button').length, 0);
});

test('admin can explicitly inspect canonical earning evidence without issuing points or showing private details', async () => {
  const eventId = '22222222-2222-4222-8222-222222222222';
  const calls = [];
  const element = root();
  createFormalRewardAdminPanel({
    root: element,
    authorized: true,
    loadQueue: async () => ({ status: 'queue_ready', items: [] }),
    onResolve: async () => {
      throw Error('POINT_MUTATION_FORBIDDEN');
    },
    inspectEarningSource: async (input) => {
      calls.push(input);
      return {
        ok: true,
        eventType: input.eventType,
        status: 'canonical_source_verified',
        mayIssuePoints: false,
        verifiedComment: { body: 'PRIVATE_COMMENT_BODY' },
        readerId: 'PRIVATE_READER_ID'
      };
    }
  });
  assert.equal(calls.length, 0);
  const select = descendants(element, (n) => n.tag === 'select')[0];
  const input = descendants(element, (n) => n.tag === 'input')[0];
  const lookup = descendants(
    element,
    (n) => n.tag === 'button' && n.textContent === '根拠を確認'
  )[0];
  assert.ok(select);
  assert.ok(input);
  assert.ok(lookup);
  input.value = 'bad-input';
  await lookup.handlers.click();
  assert.equal(calls.length, 0);
  assert.match(flatten(element), /イベントIDを確認/);
  input.value = eventId;
  select.value = 'novel_episode_comment_reviewed';
  await lookup.handlers.click();
  assert.deepEqual(calls, [
    { eventType: 'novel_episode_comment_reviewed', eventId }
  ]);
  assert.match(flatten(element), /根拠イベントを確認しました/);
  assert.match(flatten(element), /Point発行は行っていません/);
  assert.doesNotMatch(flatten(element), /PRIVATE_COMMENT_BODY|PRIVATE_READER_ID/);
});

test('unverified source results fail closed and non-admin never mounts source inspector', async () => {
  let calls = 0;
  const element = root();
  createFormalRewardAdminPanel({
    root: element,
    authorized: false,
    loadQueue: async () => {
      throw Error('NO_ADMIN_READ');
    },
    onResolve: async () => {
      throw Error('NO_ADMIN_WRITE');
    },
    inspectEarningSource: async () => {
      calls++;
    }
  });
  assert.equal(
    descendants(
      element,
      (n) => n.tag === 'button' && n.textContent === '根拠を確認'
    ).length,
    0
  );
  assert.equal(calls, 0);

  const authorized = root();
  createFormalRewardAdminPanel({
    root: authorized,
    authorized: true,
    loadQueue: async () => ({ status: 'queue_ready', items: [] }),
    onResolve: async () => {
      throw Error('NO_ADMIN_WRITE');
    },
    inspectEarningSource: async () => ({
      ok: true,
      eventType: 'valid_read_qualified',
      status: 'canonical_source_verified',
      mayIssuePoints: true
    })
  });
  const input = descendants(authorized, (n) => n.tag === 'input')[0];
  input.value = '22222222-2222-4222-8222-222222222222';
  const lookup = descendants(
    authorized,
    (n) => n.tag === 'button' && n.textContent === '根拠を確認'
  )[0];
  await lookup.handlers.click();
  assert.match(flatten(authorized), /確認結果を検証できません/);
  assert.doesNotMatch(flatten(authorized), /根拠イベントを確認しました/);
});
