// NOVELIGHT future reader reward panel. Not mounted on beta pages.
// Every visible balance/eligibility is server-supplied; the browser cannot
// authorize a Point debit, vendor request or AI execution.
(function () {
  'use strict';
  const POINTS_PER_YEN = 10;
  const MIN_EXCHANGE_POINTS = 30000;
  const MAINTENANCE_XP = 200;
  const number = (value) => Number(value).toLocaleString('ja-JP');
  const validPoints = (value) => Number.isSafeInteger(value) && value >= 0;
  const yen = (points) =>
    validPoints(points)
      ? (points / POINTS_PER_YEN).toLocaleString('ja-JP', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 1
        })
      : '—';
  const label = (value) =>
    typeof value === 'string' ? value.slice(0, 100) : '—';
  const safeDate = (value) => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
      return '未確定';
    return new Date(value).toLocaleDateString('ja-JP');
  };
  const STATUS_NAMES = Object.freeze({
    confirmed: '確定',
    pending: '保留中',
    reserved: '予約中',
    frozen: '凍結',
    cancelled: '取消',
    refunded: '返却'
  });
  const TYPE_NAMES = Object.freeze({
    read: '読書報酬',
    comment: 'コメント報酬',
    level: 'レベル到達',
    badge: '称号報酬',
    exchange: 'デジタルギフト交換',
    ai: 'AI機能利用',
    refund: '返却'
  });
  const el = (tag, className = '', value = null) => {
    const node = document.createElement(tag);
    node.className = className;
    if (value !== null) node.textContent = String(value);
    return node;
  };

  function normalizeSnapshot(source) {
    const s = source && typeof source === 'object' ? source : {};
    const wallet = s.wallet || {};
    const account = s.account || {};
    const level =
      Number.isInteger(account.level) &&
      account.level >= 1 &&
      account.level <= 100
        ? account.level
        : null;
    const verified = s.serverVerified === true;
    return Object.freeze({
      verified,
      formalEnabled: verified && s.formalEnabled === true,
      level: verified ? level : null,
      progress:
        verified &&
        Number.isSafeInteger(account.progressXp) &&
        account.progressXp >= 0
          ? account.progressXp
          : null,
      required:
        verified &&
        Number.isSafeInteger(account.requiredXp) &&
        account.requiredXp > 0
          ? account.requiredXp
          : null,
      earned30:
        verified &&
        Number.isSafeInteger(account.earnedXpInPeriod) &&
        account.earnedXpInPeriod >= 0
          ? account.earnedXpInPeriod
          : null,
      nextMaintenance: verified
        ? safeDate(account.nextMaintenanceAt)
        : '未確定',
      available:
        verified && validPoints(wallet.availablePoints)
          ? wallet.availablePoints
          : null,
      exchangeEligible:
        verified && validPoints(wallet.exchangeEligiblePoints)
          ? wallet.exchangeEligiblePoints
          : null,
      held:
        verified && validPoints(wallet.heldPoints) ? wallet.heldPoints : null,
      history:
        verified && Array.isArray(s.history) ? s.history.slice(0, 40) : [],
      aiFeatures: Array.isArray(s.aiFeatures) ? s.aiFeatures.slice(0, 25) : [],
      exchangeEnabled: verified && s.exchangeEnabled === true,
      giftProviderReady: verified && s.giftProviderReady === true
    });
  }

  function createRewardReaderPanel({
    root,
    fetchSnapshot,
    onExchange,
    onAiUse
  }) {
    if (
      !root ||
      typeof root.replaceChildren !== 'function' ||
      typeof fetchSnapshot !== 'function'
    )
      throw new TypeError(
        'A real root and trusted snapshot loader are required'
      );
    let latest = normalizeSnapshot(null);
    let busy = false;
    let tab = 'history';
    const shell = el('section', 'rr-shell');
    const h = el('header', 'rr-heading');
    h.append(el('p', 'rr-kicker', 'NOVELIGHT / SCOUT REWARD'));
    h.append(el('h2', '', 'スカウト報酬'));
    h.append(
      el(
        'p',
        'rr-subtitle',
        '読書で獲得したScout Pointと、正式版の利用先を確認できます。'
      )
    );
    const notice = el('p', 'rr-notice');
    notice.setAttribute('role', 'status');
    const metrics = el('div', 'rr-metrics');
    const tabs = el('div', 'rr-tabs');
    tabs.setAttribute('role', 'tablist');
    const contents = el('div', 'rr-content');
    const feedback = el('p', 'rr-feedback');
    feedback.setAttribute('aria-live', 'polite');
    shell.append(h, notice, metrics, tabs, contents, feedback);
    root.replaceChildren(shell);

    function metric(name, value, detail) {
      const card = el('article', 'rr-metric');
      card.append(el('span', 'rr-metric-label', name), el('strong', '', value));
      if (detail) card.append(el('small', '', detail));
      return card;
    }
    function refreshMetrics() {
      const s = latest;
      metrics.replaceChildren(
        metric(
          'SCOUT LEVEL',
          s.level === null ? '—' : 'Lv.' + s.level,
          s.level === 100
            ? '最高レベル'
            : s.progress !== null && s.required !== null
              ? '次Lv.まで ' +
                number(Math.max(0, s.required - s.progress)) +
                ' XP'
              : '進捗未確定'
        ),
        metric(
          '利用可能',
          s.available === null ? '—' : number(s.available) + ' pt',
          s.available === null
            ? '確定残高のみ表示'
            : '約 ' + yen(s.available) + ' 円相当'
        ),
        metric(
          '外部交換対象',
          s.exchangeEligible === null
            ? '—'
            : number(s.exchangeEligible) + ' pt',
          '正式版獲得分の適格Pointのみ'
        ),
        metric(
          '保留・凍結',
          s.held === null ? '—' : number(s.held) + ' pt',
          '利用可能残高に含めません'
        )
      );
      if (
        s.level !== null &&
        s.level < 100 &&
        s.progress !== null &&
        s.required !== null
      ) {
        const progress = el('progress', 'rr-level-progress');
        progress.max = s.required;
        progress.value = Math.min(s.progress, s.required);
        progress.setAttribute('aria-label', '次のScout LevelまでのXP進捗');
        metrics.append(progress);
      }
      const remaining =
        s.earned30 === null
          ? '—'
          : number(Math.max(0, MAINTENANCE_XP - s.earned30));
      const levelNote = el(
        'p',
        'rr-progress-meta',
        '30日間の確定XP：' +
          (s.earned30 === null ? '—' : number(s.earned30)) +
          ' / ' +
          MAINTENANCE_XP +
          ' XP　・　維持まで ' +
          remaining +
          ' XP　・　次の判定：' +
          s.nextMaintenance
      );
      metrics.append(levelNote);
      notice.textContent = s.formalEnabled
        ? '正式版の利用条件を確認してからお申し込みください。'
        : '現在は正式版の準備中です。Pointの交換・AI直接利用はまだできません。';
    }
    function selectTab(name) {
      if (!['history', 'exchange', 'ai'].includes(name)) return;
      tab = name;
      tabs.replaceChildren();
      for (const [key, title] of [
        ['history', '報酬・利用履歴'],
        ['exchange', 'デジタルギフト交換'],
        ['ai', 'AIに使う']
      ]) {
        const b = el('button', '', title);
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(tab === key));
        b.addEventListener('click', () => selectTab(key));
        tabs.append(b);
      }
      contents.replaceChildren();
      if (tab === 'history') drawHistory();
      else if (tab === 'exchange') drawExchange();
      else drawAi();
    }
    function drawHistory() {
      const heading = el('h3', '', 'Point履歴');
      const list = el('div', 'rr-history');
      if (!latest.history.length) {
        list.append(el('p', 'rr-muted', '表示できる確定履歴がありません。'));
      }
      for (const item of latest.history) {
        if (!item || !Number.isSafeInteger(item.points)) continue;
        const row = el('div', 'rr-history-row');
        const left = el('div');
        left.append(el('strong', '', TYPE_NAMES[item.kind] || 'Point変動'));
        left.append(
          el(
            'small',
            '',
            safeDate(item.at) + '・' + (STATUS_NAMES[item.status] || '確認中')
          )
        );
        row.append(
          left,
          el(
            'b',
            '',
            (item.points > 0 ? '+' : '') + number(item.points) + ' pt'
          )
        );
        list.append(row);
      }
      contents.append(heading, list);
    }
    function drawExchange() {
      const s = latest;
      contents.append(el('h3', '', 'デジタルギフト交換'));
      contents.append(
        el(
          'p',
          'rr-muted',
          '最低交換額は ' +
            number(MIN_EXCHANGE_POINTS) +
            ' pt（3,000円相当）。旧βで獲得したPointは外部交換対象に含まれません。'
        )
      );
      const form = el('form', 'rr-form');
      const lab = el('label', '', '申請するScout Point');
      const amount = el('input');
      amount.name = 'pointAmount';
      amount.type = 'number';
      amount.min = String(MIN_EXCHANGE_POINTS);
      amount.step = '1';
      amount.inputMode = 'numeric';
      amount.placeholder = '30000';
      lab.append(amount);
      const quote = el('p', 'rr-quote', '交換額を入力してください。');
      const send = el(
        'button',
        'rr-action',
        s.formalEnabled ? '交換を申請する' : '交換受付準備中'
      );
      send.type = 'submit';
      const available =
        s.available !== null && s.exchangeEligible !== null
          ? Math.min(s.available, s.exchangeEligible)
          : null;
      const active =
        s.formalEnabled &&
        s.exchangeEnabled &&
        s.giftProviderReady &&
        typeof onExchange === 'function' &&
        available !== null;
      send.disabled = !active;
      amount.addEventListener('input', () => {
        const n = Number(amount.value);
        const valid = Number.isSafeInteger(n) && n >= MIN_EXCHANGE_POINTS;
        quote.textContent = !valid
          ? '最低 ' + number(MIN_EXCHANGE_POINTS) + ' ptから申請できます。'
          : available === null
            ? '交換可能残高が未確認です。'
            : n > available
              ? '交換可能残高を超えています。'
              : number(n) + ' pt = ' + yen(n) + ' 円相当';
      });
      form.append(lab, quote, send);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy || !active) return;
        const n = Number(amount.value);
        if (
          !Number.isSafeInteger(n) ||
          n < MIN_EXCHANGE_POINTS ||
          n > available
        ) {
          feedback.textContent = '申請額または残高をご確認ください。';
          return;
        }
        busy = true;
        send.disabled = true;
        feedback.textContent = '申請状況を確認しています。';
        try {
          const result = await onExchange({ amountPoints: n });
          feedback.textContent =
            result?.status === 'request_received'
              ? '交換申請を受け付けました。審査状況は履歴で確認してください。'
              : '申請は確定していません。内容をご確認ください。';
          await reload();
        } catch {
          feedback.textContent =
            '処理が確認できませんでした。残高と申請履歴をご確認ください。';
        } finally {
          busy = false;
          send.disabled = !active;
        }
      });
      contents.append(form);
      if (!active)
        contents.append(
          el(
            'p',
            'rr-warning',
            '交換先の契約・本人確認・審査条件が確定するまで申請はできません。'
          )
        );
    }
    function drawAi() {
      contents.append(el('h3', '', 'Scout PointでAI機能を利用'));
      contents.append(
        el(
          'p',
          'rr-muted',
          'AI Creditへの交換は不要です。機能ごとのPoint価格が確定後、利用時に直接消費します。'
        )
      );
      if (!latest.aiFeatures.length)
        contents.append(el('p', 'rr-muted', '利用できるAI機能は準備中です。'));
      for (const feature of latest.aiFeatures) {
        if (!feature || typeof feature.id !== 'string') continue;
        const card = el('div', 'rr-ai-card');
        const name = el('div');
        name.append(el('strong', '', label(feature.name)));
        const price =
          validPoints(feature.pricePoints) && feature.pricePoints > 0
            ? number(feature.pricePoints) + ' pt'
            : '料金未確定';
        name.append(el('small', '', price));
        const use = el('button', 'rr-action', '利用する');
        use.type = 'button';
        const permitted =
          latest.formalEnabled &&
          feature.approved === true &&
          validPoints(feature.pricePoints) &&
          feature.pricePoints > 0 &&
          latest.available !== null &&
          latest.available >= feature.pricePoints &&
          typeof onAiUse === 'function';
        use.disabled = !permitted;
        use.addEventListener('click', async () => {
          if (!permitted || busy) return;
          busy = true;
          use.disabled = true;
          try {
            const result = await onAiUse({ featureId: feature.id });
            feedback.textContent =
              result?.status === 'started'
                ? 'AI機能の実行を受け付けました。'
                : 'AI機能の利用は確定していません。';
            await reload();
          } catch {
            feedback.textContent =
              '利用状態が確認できません。履歴をご確認ください。';
          } finally {
            busy = false;
            use.disabled = !permitted;
          }
        });
        card.append(name, use);
        contents.append(card);
      }
    }
    async function reload() {
      feedback.textContent = '';
      let result;
      try {
        result = await fetchSnapshot();
      } catch {
        latest = normalizeSnapshot(null);
        feedback.textContent = '残高を取得できません。処理を停止しました。';
      }
      if (result) latest = normalizeSnapshot(result);
      refreshMetrics();
      selectTab(tab);
      return latest;
    }
    void reload();
    return Object.freeze({ reload, getSnapshot: () => latest });
  }
  globalThis.NovelightFormalScoutReward = Object.freeze({
    POINTS_PER_YEN,
    MIN_EXCHANGE_POINTS,
    normalizeSnapshot,
    createRewardReaderPanel
  });
})();
