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
    const list = node('div', 'rr-admin-list');
    shell.append(title, caption, notice, list);
    root.replaceChildren(shell);

    async function refresh() {
      const requestId = ++latestRequest;
      list.replaceChildren();
      if (authorized !== true) {
        notice.textContent = '管理者の本人確認と正式版の利用開始が必要です。';
        return { status: 'admin_not_verified' };
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
      onResolve: ({ operationId, action }) =>
        request({ method: 'POST', body: { operationId, action } })
    });
  }
  globalThis.NovelightFormalRewardAdmin = Object.freeze({
    createFormalRewardAdminPanel,
    createFormalAdminBindings
  });
})();
