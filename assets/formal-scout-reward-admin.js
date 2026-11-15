// Unpublished administrator queue component for formal gift requests.
// The actual service must re-authenticate every call with requireAdmin.
(function () {
  'use strict';
  const fmt = (n) => Number(n).toLocaleString('ja-JP');
  const node = (tag, name = '', value) => {
    const element = document.createElement(tag);
    element.className = name;
    if (value !== undefined) element.textContent = String(value);
    return element;
  };
  function createFormalRewardAdminPanel({
    root,
    authorized,
    loadQueue,
    loadRefunds,
    loadNewReaderSummary,
    loadRewardOverview,
    loadBadgeCatalog,
    loadBadgeHistory,
    loadWalletCohort,
    loadSettlementRecovery,
    inspectEarningSource,
    onResolve
  } = {}) {
    if (!root || typeof root.replaceChildren !== 'function')
      throw new TypeError('Admin panel root required');
    if (typeof loadQueue !== 'function' || typeof onResolve !== 'function')
      throw new TypeError('Injected admin operations required');
    let inflight = false;
    let latestRequest = 0;
    const shell = node('section', 'rr-admin-shell');
    const title = node('h2', '', 'SCOUT REWARD / 交換申請管理');
    const caption = node(
      'p',
      'rr-admin-muted',
      'デジタルギフトの申請を確認します。引渡し判定にはサーバー側の事業者照合が必要です。'
    );
    const notice = node('p', 'rr-admin-message');
    notice.setAttribute('role', 'status');
    const records = node('div', 'rr-admin-list');
    const audits = node('section', 'rr-admin-audits');
    const list = node('div', 'rr-admin-list');
    const refunds = node('div', 'rr-admin-list');
    const newReaders = node('div', 'rr-admin-list');
    const earningReview = node('section', 'rr-admin-earning-review');
    shell.append(
      title,
      caption,
      notice,
      records,
      audits,
      earningReview,
      newReaders,
      list,
      refunds
    );
    root.replaceChildren(shell);

    // The existing admin-only HTTP handler returns only a source verdict.
    // Never fetch on mount or display comment text, reader identity or claims.
    if (authorized === true && typeof inspectEarningSource === 'function') {
      const sourceType = node('select', 'rr-admin-source-type');
      sourceType.setAttribute('aria-label', '報酬根拠の種類');
      for (const [value, label] of [
        ['valid_read_qualified', '有効読書'],
        ['novel_episode_comment_reviewed', 'コメント']
      ]) {
        const option = node('option', '', label);
        option.value = value;
        sourceType.append(option);
      }
      sourceType.value = 'valid_read_qualified';
      const sourceId = node('input', 'rr-admin-source-id');
      sourceId.type = 'text';
      sourceId.maxLength = 36;
      sourceId.placeholder = '根拠イベントID（UUID）';
      sourceId.setAttribute('aria-label', '根拠イベントID');
      sourceId.setAttribute('autocomplete', 'off');
      const lookup = node('button', 'rr-admin-action', '根拠を確認');
      lookup.type = 'button';
      const status = node('p', 'rr-admin-muted', '未照合');
      status.setAttribute('role', 'status');
      const actions = node('div', 'rr-admin-actions');
      actions.append(sourceType, sourceId, lookup);
      earningReview.append(
        node('h3', '', '読書・コメント報酬の根拠照合'),
        node(
          'p',
          'rr-admin-muted',
          '既存の認証済み根拠イベントを読み取り専用で照合します。Point発行・報酬確定は行いません。'
        ),
        actions,
        status
      );
      const validId =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let checking = false;
      lookup.addEventListener('click', async () => {
        if (checking) return;
        const eventType = sourceType.value;
        const eventId = sourceId.value;
        if (
          ![
            'valid_read_qualified',
            'novel_episode_comment_reviewed'
          ].includes(eventType) ||
          typeof eventId !== 'string' ||
          !validId.test(eventId)
        ) {
          status.textContent = '対象の種類とイベントIDを確認してください。';
          return;
        }
        checking = true;
        lookup.disabled = true;
        sourceType.disabled = true;
        sourceId.disabled = true;
        status.textContent = '根拠を照合しています。';
        try {
          const report = await inspectEarningSource({ eventType, eventId });
          const verdict = {
            canonical_source_verified: '根拠イベントを確認しました。',
            canonical_source_missing: '根拠イベントが見つかりません。',
            canonical_source_invalid: '根拠イベントの内容を確認できません。',
            history_limit_requires_review: '過去履歴の追加確認が必要です。'
          };
          status.textContent =
            report?.ok === true &&
            report?.eventType === eventType &&
            report?.mayIssuePoints === false &&
            Object.hasOwn(verdict, report?.status)
              ? verdict[report.status] + ' Point発行は行っていません。'
              : '根拠の確認結果を検証できません。';
        } catch {
          status.textContent = '根拠を確認できませんでした。';
        } finally {
          checking = false;
          lookup.disabled = false;
          sourceType.disabled = false;
          sourceId.disabled = false;
        }
      });
    }

    async function refresh() {
      const requestId = ++latestRequest;
      records.replaceChildren();
      audits.replaceChildren();
      list.replaceChildren();
      refunds.replaceChildren();
      newReaders.replaceChildren();
      if (authorized !== true) {
        notice.textContent = '管理者の本人確認と正式版の利用開始が必要です。';
        return { status: 'admin_not_verified' };
      }
      // The operator can inspect cost and obligations even when a gift
      // provider or the separate exchange queue is unavailable.
      if (typeof loadRewardOverview === 'function') {
        let overview;
        try {
          overview = await loadRewardOverview();
        } catch {
          overview = null;
        }
        if (requestId !== latestRequest)
          return { status: 'stale_queue_response' };
        const keys = [
          'issuedMonth',
          'issuedTotal',
          'readMonth',
          'commentMonth',
          'giftSpentNet',
          'aiSpentNet',
          'eligibleAvailable',
          'eligibleReserved',
          'pendingExchangePoints',
          'pendingExchangeCount'
        ];
        if (
          overview?.status === 'reward_overview_ready' &&
          overview.pointsPerYen === 10 &&
          keys.every(
            (key) => Number.isSafeInteger(overview[key]) && overview[key] >= 0
          ) &&
          Array.isArray(overview.recent) &&
          overview.recent.length <= 30
        ) {
          const money = (value) =>
            fmt(value) +
            ' pt（' +
            (value / 10).toLocaleString('ja-JP', {
              maximumFractionDigits: 1
            }) +
            '円相当）';
          records.append(
            node('h3', '', 'SCOUT REWARD / 発行・利用記録'),
            node(
              'p',
              'rr-admin-muted',
              '月次固定予算は設定しません。今月は日本時間の暦月です。'
            )
          );
          const metricCards = node('div', 'rr-admin-metrics');
          for (const [label, key] of [
            ['今月の新規発行', 'issuedMonth'],
            ['今月の読書報酬', 'readMonth'],
            ['今月のコメント報酬', 'commentMonth'],
            ['累計新規発行', 'issuedTotal'],
            ['外部交換・純利用', 'giftSpentNet'],
            ['AI機能・純利用', 'aiSpentNet'],
            ['現在の交換適格残高', 'eligibleAvailable'],
            ['交換申請で拘束中の適格残高', 'eligibleReserved'],
            ['未完了の交換申請総額', 'pendingExchangePoints']
          ]) {
            const card = node('article', 'rr-admin-request');
            card.append(
              node('strong', '', label),
              node('p', 'rr-admin-muted', money(overview[key]))
            );
            metricCards.append(card);
          }
          records.append(metricCards);
          records.append(
            node(
              'p',
              'rr-admin-muted',
              '未完了の交換申請：' + fmt(overview.pendingExchangeCount) + '件'
            ),
            node('h3', '', '最近のPoint台帳（最大30件）')
          );
          if (!overview.recent.length)
            records.append(
              node('p', 'rr-admin-muted', '正式版のPoint記録はまだありません。')
            );
          for (const event of overview.recent) {
            if (
              !event ||
              typeof event.userId !== 'string' ||
              typeof event.eventId !== 'string' ||
              typeof event.kind !== 'string' ||
              !event.kind.startsWith('formal_') ||
              !Number.isSafeInteger(event.points) ||
              !['confirmed', 'pending', 'frozen', 'cancelled'].includes(
                event.status
              ) ||
              typeof event.occurredAt !== 'string' ||
              !Number.isFinite(Date.parse(event.occurredAt))
            ) {
              records.replaceChildren(
                node(
                  'p',
                  'rr-admin-muted',
                  'Point台帳の取得内容を確認できません。'
                )
              );
              break;
            }
            const item = node('article', 'rr-admin-request');
            item.append(
              node('strong', '', event.kind + '：' + fmt(event.points) + ' pt'),
              node('p', 'rr-admin-muted', '状態：' + event.status),
              node('p', 'rr-admin-muted', 'ユーザーID：' + event.userId),
              node('p', 'rr-admin-muted', '記録日時：' + event.occurredAt),
              node('p', 'rr-admin-muted', '記録ID：' + event.eventId)
            );
            records.append(item);
          }
        } else {
          records.append(
            node(
              'p',
              'rr-admin-muted',
              '報酬発行・利用記録はまだ確認できません。'
            )
          );
        }
      } else {
        records.append(
          node('p', 'rr-admin-muted', '報酬発行・利用記録の取得は未接続です。')
        );
      }
      // These four aggregate-only reports already have separate, authorized
      // GET views in the unregistered formal admin host. A missing, stale or
      // malformed report always remains review-only: no activation controls.
      audits.append(
        node('h3', '', '正式報酬 / 公開前の整合性監査'),
        node(
          'p',
          'rr-admin-muted',
          '公開OFF。表示は診断用で、データ移行・Point付与・交換・返金・復旧を実行しません。'
        )
      );
      const views = [
        [
          loadBadgeCatalog,
          '読者称号100種',
          'formal_badge_catalog_review_only',
          [
            ['称号定義', 'total'],
            ['有効化済み', 'enabled'],
            ['理論報酬', 'theoreticalPointReward']
          ]
        ],
        [
          loadBadgeHistory,
          '称号獲得・Point履歴',
          'formal_badge_history_review_only',
          [
            ['獲得履歴', 'earned_badges'],
            ['旧単位イベント', 'legacy_unit_events'],
            ['付与履歴未照合', 'earned_without_event'],
            ['紐づかないPoint', 'orphan_reader_badge_events']
          ]
        ],
        [
          loadWalletCohort,
          '正式Wallet・正規台帳',
          'formal_wallet_cohort_review_only',
          [
            ['Wallet利用者', 'wallet_users'],
            ['Wallet未作成', 'ledger_without_wallet_users'],
            ['残高不一致', 'wallet_balance_mismatch_users'],
            ['未確定Point行', 'unsettled_ledger_rows']
          ]
        ],
        [
          loadSettlementRecovery,
          '決済履歴・停止復旧',
          'formal_settlement_recovery_review_only',
          [
            ['操作件数', 'operations_total'],
            ['状態履歴不一致', 'history_mismatch_operations'],
            ['引落し欠落', 'missing_spend_operations'],
            ['返金欠落', 'missing_refund_operations'],
            ['孤立した決済Point', 'orphan_settlement_ledger_events']
          ]
        ]
      ];
      for (const [loader, heading, status, fields] of views) {
        const panel = node('article', 'rr-admin-request');
        panel.append(node('strong', '', heading));
        audits.append(panel);
        if (typeof loader !== 'function') {
          panel.append(
            node('p', 'rr-admin-muted', '監査API未接続・未検証。公開OFFを維持します。')
          );
          continue;
        }
        let report;
        try {
          report = await loader();
        } catch {
          report = null;
        }
        if (requestId !== latestRequest)
          return { status: 'stale_queue_response' };
        const verifiedShape =
          report?.status === status &&
          report.readyForPublicRelease === false &&
          report.mayWriteDb === false &&
          report.mayIssuePoints === false &&
          report.observed &&
          typeof report.observed === 'object' &&
          !Array.isArray(report.observed) &&
          Array.isArray(report.blockers) &&
          report.blockers.length <= 50 &&
          report.blockers.every(
            (reason) => typeof reason === 'string' && reason.length <= 160
          ) &&
          fields.every(
            ([, key]) =>
              Number.isSafeInteger(report.observed[key]) &&
              report.observed[key] >= 0
          );
        if (!verifiedShape) {
          panel.append(
            node('p', 'rr-admin-muted', '監査結果が不完全・未検証です。公開OFFを維持します。')
          );
          continue;
        }
        for (const [label, key] of fields) {
          panel.append(
            node(
              'p',
              'rr-admin-muted',
              label + '：' + fmt(report.observed[key])
            )
          );
        }
        panel.append(
          node(
            'p',
            'rr-admin-muted',
            '未解決の確認事項：' +
              fmt(report.blockers.length) +
              '件。実DBの安全性や公開許可を示す数値ではありません。'
          )
        );
      }
      let result;
      try {
        result = await loadQueue();
      } catch {
        if (requestId !== latestRequest)
          return { status: 'stale_queue_response' };
        notice.textContent = '申請一覧を取得できませんでした。';
        return { status: 'queue_unavailable' };
      }
      if (requestId !== latestRequest)
        return { status: 'stale_queue_response' };
      if (result?.status !== 'queue_ready' || !Array.isArray(result.items)) {
        notice.textContent = '申請一覧は現在利用できません。';
        return { status: 'queue_unavailable' };
      }
      notice.textContent =
        '未完了の交換申請：' + fmt(result.items.length) + '件';
      if (typeof loadNewReaderSummary === 'function') {
        let overview = null;
        try {
          overview = await loadNewReaderSummary();
        } catch {
          /* unavailable */
        }
        if (requestId !== latestRequest)
          return { status: 'stale_queue_response' };
        if (
          overview?.status === 'new_reader_summary_ready' &&
          [
            overview.totalRegistered,
            overview.initialized,
            overview.partial
          ].every((value) => Number.isSafeInteger(value) && value >= 0)
        ) {
          newReaders.append(
            node('h3', '', '正式版以降の新規読者'),
            node(
              'p',
              'rr-admin-muted',
              '登録：' +
                fmt(overview.totalRegistered) +
                '人　初期化完了：' +
                fmt(overview.initialized) +
                '人　要確認：' +
                fmt(overview.partial) +
                '人'
            )
          );
        } else {
          newReaders.append(
            node('p', 'rr-admin-muted', '新規読者の初期化状況は未確認です。')
          );
        }
      }
      for (const item of result.items) {
        if (
          !item ||
          typeof item.operationId !== 'string' ||
          typeof item.userId !== 'string' ||
          !Number.isSafeInteger(item.amountPoints) ||
          item.amountPoints < 30000 ||
          item.phase !== 'reserved'
        )
          continue;
        const card = node('article', 'rr-admin-request');
        const detail = node('div');
        detail.append(
          node(
            'strong',
            '',
            fmt(item.amountPoints) +
              ' pt（' +
              fmt(item.amountPoints / 10) +
              '円相当）'
          ),
          node('p', 'rr-admin-muted', '受付ID：' + item.operationId),
          node('p', 'rr-admin-muted', '申請者ID：' + item.userId)
        );
        const actions = node('div', 'rr-admin-actions');
        for (const [action, label] of [
          ['confirm_fulfilled', '事業者への引渡しを照合'],
          ['release_unfulfilled', '未引渡しを照合して予約解除']
        ]) {
          const button = node('button', 'rr-admin-action', label);
          button.type = 'button';
          button.addEventListener('click', async () => {
            if (inflight) return;
            inflight = true;
            button.disabled = true;
            notice.textContent = '事業者の処理結果を確認しています。';
            try {
              const done = await onResolve({
                operationId: item.operationId,
                action
              });
              if (done?.status === 'committed' || done?.status === 'released') {
                await refresh();
              } else {
                notice.textContent =
                  'サーバー側の引渡し証拠が未確認のため、処理を保留しました。';
              }
            } catch {
              notice.textContent =
                '処理結果が確認できません。申請状態を再確認してください。';
            } finally {
              inflight = false;
              button.disabled = false;
            }
          });
          actions.append(button);
        }
        card.append(detail, actions);
        list.append(card);
      }
      if (!list.children.length)
        list.append(
          node('p', 'rr-admin-muted', '現在、未完了の交換申請はありません。')
        );
      if (typeof loadRefunds === 'function') {
        let candidates;
        try {
          candidates = await loadRefunds();
        } catch {
          candidates = null;
        }
        if (requestId !== latestRequest)
          return { status: 'stale_queue_response' };
        if (
          candidates?.status === 'refund_candidates_ready' &&
          Array.isArray(candidates.items)
        ) {
          refunds.append(node('h3', '', '確定済み取引の返金照合'));
          for (const item of candidates.items) {
            if (
              !item ||
              typeof item.operationId !== 'string' ||
              typeof item.userId !== 'string' ||
              !Number.isSafeInteger(item.amountPoints) ||
              item.amountPoints <= 0 ||
              item.phase !== 'committed'
            )
              continue;
            const card = node('article', 'rr-admin-request');
            const detail = node('div');
            detail.append(
              node('strong', '', fmt(item.amountPoints) + ' pt'),
              node('p', 'rr-admin-muted', '受付ID：' + item.operationId),
              node(
                'p',
                'rr-admin-muted',
                item.purpose === 'ai_direct_use'
                  ? 'AI直接利用'
                  : 'デジタルギフト交換'
              )
            );
            const button = node(
              'button',
              'rr-admin-action',
              '返金・回収を照合'
            );
            button.type = 'button';
            button.addEventListener('click', async () => {
              if (inflight) return;
              inflight = true;
              button.disabled = true;
              notice.textContent = '元の確定取引と返金証跡を確認しています。';
              try {
                const outcome = await onResolve({
                  operationId: item.operationId,
                  action: 'refund_recovered'
                });
                if (outcome?.status === 'refunded') await refresh();
                else
                  notice.textContent =
                    '独立した返金・回収証跡が未確認のため、返金を実施していません。';
              } catch {
                notice.textContent =
                  '返金の状態が確認できません。再度一覧を確認してください。';
              } finally {
                inflight = false;
                button.disabled = false;
              }
            });
            card.append(detail, button);
            refunds.append(card);
          }
        }
      }
      return result;
    }
    void refresh();
    return Object.freeze({ refresh });
  }
  function createFormalAdminBindings({ request }) {
    if (typeof request !== 'function')
      throw new TypeError('Authenticated administrator transport required');
    return Object.freeze({
      loadQueue: () => request({ method: 'GET' }),
      loadRefunds: () => request({ method: 'GET', query: { view: 'refunds' } }),
      loadNewReaderSummary: () =>
        request({ method: 'GET', query: { view: 'new_readers' } }),
      loadRewardOverview: () =>
        request({ method: 'GET', query: { view: 'reward_overview' } }),
      loadBadgeCatalog: () =>
        request({ method: 'GET', query: { view: 'badge_catalog' } }),
      loadBadgeHistory: () =>
        request({ method: 'GET', query: { view: 'badge_history' } }),
      loadWalletCohort: () =>
        request({ method: 'GET', query: { view: 'wallet_cohort' } }),
      loadSettlementRecovery: () =>
        request({ method: 'GET', query: { view: 'settlement_recovery' } }),
      inspectEarningSource: ({ eventType, eventId }) =>
        request({
          method: 'GET',
          query: { view: 'earning_source', eventType, eventId }
        }),
      onResolve: ({ operationId, action }) =>
        request({ method: 'POST', body: { operationId, action } })
    });
  }
  globalThis.NovelightFormalRewardAdmin = Object.freeze({
    createFormalRewardAdminPanel,
    createFormalAdminBindings
  });
})();
