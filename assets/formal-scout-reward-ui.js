// NOVELIGHT future reader reward panel. Not mounted on beta pages.
// Every visible balance/eligibility is server-supplied; the browser cannot
// authorize a Point debit, vendor request or AI execution.
(function () {
  'use strict';
  const POINTS_PER_YEN = 10;
  const MIN_EXCHANGE_POINTS = 30000;
  const MAINTENANCE_XP = 200;
  // Exact 10-stage rank names from MASTER §49.22. The formal UI derives
  // the rank only from a server-verified Level, never from browser XP.
  const SCOUT_RANK_NAMES = Object.freeze([
    'NOCTIS', 'VESPER', 'UMBRA', 'ASTRA', 'LUCENT',
    'AURELIS', 'CELESTIA', 'EMPYREAN', 'SERAPH', 'LUMINARIS'
  ]);
  const rankAtLevel = (level) =>
    Number.isSafeInteger(level) && level >= 1 && level <= 100
      ? SCOUT_RANK_NAMES[Math.floor((level - 1) / 10)]
      : null;
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

  const SEED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function normalizeSeedEvidence(value) {
    if (
      !value ||
      value.status !== 'formal_reader_seed_evidence_review_only' ||
      value.readyForPublicRelease !== false ||
      value.historicalXpBackfillAllowed !== false ||
      value.mayIssueXp !== false ||
      value.independentlyVerifiedEntireLedger !== false ||
      typeof value.moreSeedsAvailable !== 'boolean' ||
      !Array.isArray(value.items) ||
      value.items.length > 60
    )
      return null;

    const seen = new Set();
    const items = [];
    let eventCount = 0;
    for (const seed of value.items) {
      if (
        !seed ||
        typeof seed.seedId !== 'string' ||
        !SEED_ID.test(seed.seedId) ||
        seen.has(seed.seedId) ||
        !['GOLD', 'SILVER', 'BRONZE'].includes(seed.grade) ||
        !Number.isSafeInteger(seed.growth) ||
        seed.growth < 0 ||
        seed.growth > 5 ||
        typeof seed.novaPrediction !== 'boolean' ||
        (seed.workTitle !== null && typeof seed.workTitle !== 'string') ||
        !Number.isFinite(Date.parse(seed.expiresAt)) ||
        !Number.isFinite(Date.parse(seed.updatedAt)) ||
        !validPoints(seed.recordedCreditedXp) ||
        !validPoints(seed.missingXpEvidenceEvents) ||
        !Array.isArray(seed.stages)
      )
        return null;
      seen.add(seed.seedId);
      let creditedSum = 0;
      let missing = 0;
      const stages = [];
      for (const stage of seed.stages) {
        if (
          !stage ||
          !/^(growth_[2-5]|NOVA_prediction)$/.test(stage.stage) ||
          !Number.isFinite(Date.parse(stage.occurredAt)) ||
          typeof stage.creditLedgerVerified !== 'boolean' ||
          typeof stage.claimedDeltaMatchesLedger !== 'boolean' ||
          (stage.ledgerCreditedXp !== null &&
            !validPoints(stage.ledgerCreditedXp)) ||
          stage.creditLedgerVerified !==
            (stage.ledgerCreditedXp !== null) ||
          (stage.ledgerCreditedXp === null &&
            stage.claimedDeltaMatchesLedger !== false)
        )
          return null;
        if (stage.ledgerCreditedXp === null) {
          missing++;
        } else {
          creditedSum += stage.ledgerCreditedXp;
          if (!Number.isSafeInteger(creditedSum)) return null;
        }
        stages.push({
          name:
            stage.stage === 'NOVA_prediction'
              ? 'NOVA予見'
              : '+' + stage.stage.slice(-1) + ' Rank',
          at: safeDate(stage.occurredAt),
          creditedXp: stage.ledgerCreditedXp,
          matchesClaim: stage.claimedDeltaMatchesLedger
        });
        if (++eventCount > 500) return null;
      }
      if (
        creditedSum !== seed.recordedCreditedXp ||
        missing !== seed.missingXpEvidenceEvents
      )
        return null;
      items.push({
        grade: seed.grade,
        title: seed.workTitle === null ? null : label(seed.workTitle),
        creditedXp: creditedSum,
        missing,
        stages
      });
    }
    return Object.freeze({
      items,
      moreSeedsAvailable: value.moreSeedsAvailable
    });
  }

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
      rank: verified ? rankAtLevel(level) : null,
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
      scout:
        verified && s.scout &&
        Array.isArray(s.scout.badges) &&
        Array.isArray(s.scout.seeds)
          ? {
              badges: s.scout.badges.slice(0, 100),
              seeds: s.scout.seeds.slice(0, 20)
            }
          : null,
      seedEvidence:
        verified && s.formalEnabled === true
          ? normalizeSeedEvidence(s.seedEvidence)
          : null,
      authorGrowth:
        verified &&
        s.formalEnabled === true &&
        Array.isArray(s.authorGrowth?.works) &&
        Array.isArray(s.authorGrowth?.events)
          ? {
              works: s.authorGrowth.works.slice(0, 30),
              events: s.authorGrowth.events.slice(0, 80)
            }
          : null,
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
    onAiUse,
    initializeNewReader,
    newReaderOnboardingAvailable = false
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
    let lastReloadId = 0;
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
    const onboarding = el('div', 'rr-onboarding');
    const metrics = el('div', 'rr-metrics');
    const tabs = el('div', 'rr-tabs');
    tabs.setAttribute('role', 'tablist');
    const contents = el('div', 'rr-content');
    const feedback = el('p', 'rr-feedback');
    feedback.setAttribute('aria-live', 'polite');
    shell.append(h, notice, onboarding, metrics, tabs, contents, feedback);
    root.replaceChildren(shell);
    // No sign-up, account mutation, or Point issuance on page load.
    // The future approved host may expose an explicit user-action button.
    if (
      newReaderOnboardingAvailable === true &&
      typeof initializeNewReader === 'function'
    ) {
      const start = el('button', 'rr-action', '正式スカウトを利用開始');
      start.type = 'button';
      start.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        start.disabled = true;
        try {
          const result = await initializeNewReader();
          if (
            result?.status === 'new_reader_initialized' ||
            result?.status === 'new_reader_already_initialized'
          ) {
            const snapshot = await reload();
            feedback.textContent = snapshot.verified
              ? '正式スカウトの状態を確認しました。'
              : '初期化後の状態を取得できません。運営の確認が必要です。';
          } else {
            feedback.textContent =
              '初期化は保留されています。運営の確認が必要です。';
          }
        } catch {
          feedback.textContent = '初期化の状態を確認できませんでした。';
        } finally {
          busy = false;
          start.disabled = false;
        }
      });
      onboarding.append(start);
    }

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
          'SCOUT RANK',
          s.rank === null ? '—' : s.rank,
          s.rank === null ? 'サーバー確認待ち' : '10 Levelごとの正式Rank'
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
      if (!['history', 'scout', 'exchange', 'ai'].includes(name)) return;
      tab = name;
      tabs.replaceChildren();
      for (const [key, title] of [
        ['scout', '発掘・称号'],
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
      if (tab === 'scout') drawScout();
      else if (tab === 'history') drawHistory();
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
    function drawScout() {
      contents.append(el('h3', '', 'SCOUT RECORD / 読者称号と発掘'));
      if (!latest.scout) {
        contents.append(el('p', 'rr-muted',
          '本人認証済みの正式SCOUT実績はまだ取得できません。'));
        return;
      }
      const badges = latest.scout.badges;
      const seeds = latest.scout.seeds;
      const earned = badges.filter((b) => b?.earned === true).length;
      contents.append(el('p', 'rr-muted',
        '読者称号 ' + number(earned) + ' / ' + number(badges.length) +
        ' 種達成。既存の獲得記録は重複付与しません。'));
      const badgeList = el('div', 'rr-history');
      for (const badge of badges) {
        if (!badge || typeof badge.name !== 'string' ||
            typeof badge.id !== 'string') continue;
        const row = el('div', 'rr-history-row');
        const body = el('div');
        body.append(el('strong', '', label(badge.name)));
        const status = badge.earned === true
          ? '獲得済み'
          : badge.enabled === false
            ? '正式解放待ち'
            : '未獲得';
        const progress = Number.isSafeInteger(badge.progress) &&
                         Number.isSafeInteger(badge.target) &&
                         badge.target > 0
          ? number(Math.min(badge.progress, badge.target)) +
            ' / ' + number(badge.target)
          : '進捗照合中';
        body.append(el('small', '', status + ' ・ ' + progress));
        row.append(body);
        badgeList.append(row);
      }
      if (!badgeList.children.length)
        badgeList.append(el('p', 'rr-muted', '称号を読み込めません。'));
      contents.append(badgeList, el('h3', '', 'LIGHT SEED 発掘履歴'));
      const seedList = el('div', 'rr-history');
      for (const seed of seeds) {
        if (!seed || !['GOLD', 'SILVER', 'BRONZE'].includes(seed.type))
          continue;
        const row = el('div', 'rr-history-row');
        const title = typeof seed.workTitle === 'string'
          ? label(seed.workTitle) : '現在表示できない作品';
        const growth = Number.isInteger(seed.growth) &&
          seed.growth >= 0 && seed.growth <= 5 ? seed.growth : null;
        const summary = seed.novaPrediction === true
          ? 'NOVA予見' : growth === null
            ? '成長確認中' : growth >= 2
              ? '+' + growth + ' Rank 発掘'
              : '発掘経過観察';
        const info = el('div');
        info.append(el('strong', '', title),
          el('small', '', seed.type + ' LIGHT SEED ・ ' + summary));
        row.append(info);
        seedList.append(row);
      }
      if (!seedList.children.length)
        seedList.append(el('p', 'rr-muted', '表示できる発掘履歴はありません。'));
      contents.append(seedList);
      if (latest.seedEvidence) {
        contents.append(
          el('h3', '', 'LIGHT SEED 発掘段階・実記録XP'),
          el(
            'p',
            'rr-muted',
            '発掘イベントの理論XPではなく、Scout XP台帳に実際に記録された分だけを表示します。β期の未記録XPは遡及付与しません。'
          )
        );
        const evidenceList = el('div', 'rr-history');
        for (const seed of latest.seedEvidence.items) {
          const card = el('article', 'rr-history-row');
          const detail = el('div');
          detail.append(
            el('strong', '', seed.title || '現在表示できない作品'),
            el(
              'small',
              '',
              seed.grade +
                ' LIGHT SEED ・台帳で確認できたXP ' +
                number(seed.creditedXp)
            )
          );
          if (seed.missing) {
            detail.append(
              el(
                'small',
                '',
                'XP台帳の根拠が確認できない発掘段階：' +
                  number(seed.missing) +
                  '件（追加付与なし）'
              )
            );
          }
          for (const stage of seed.stages) {
            const credited =
              stage.creditedXp === null
                ? 'XP記録未確認'
                : '台帳記録 ' + number(stage.creditedXp) + ' XP';
            detail.append(
              el(
                'small',
                '',
                stage.name +
                  ' ・' +
                  stage.at +
                  ' ・' +
                  credited +
                  (stage.creditedXp !== null && !stage.matchesClaim
                    ? '（理論値と記録に差あり）'
                    : '')
              )
            );
          }
          card.append(detail);
          evidenceList.append(card);
        }
        if (!evidenceList.children.length) {
          evidenceList.append(
            el('p', 'rr-muted', '確認できる発掘段階の履歴はありません。')
          );
        }
        contents.append(evidenceList);
        if (latest.seedEvidence.moreSeedsAvailable) {
          contents.append(
            el('p', 'rr-muted', '表示件数の上限に達しました。残りの履歴は別途照合が必要です。')
          );
        }
      }
      if (latest.authorGrowth) {
        contents.append(el('h3', '', '作者専用 / 自作品のRank・成長履歴'));
        const workList = el('div', 'rr-history');
        for (const work of latest.authorGrowth.works) {
          if (!work || typeof work.title !== 'string' ||
              !Number.isInteger(work.rank) || work.rank < 1 ||
              work.rank > 6 || typeof work.rankName !== 'string')
            continue;
          const row = el('div', 'rr-history-row');
          const info = el('div');
          info.append(
            el('strong', '', label(work.title)),
            el('small', '',
              'Rank ' + work.rank + ' ' + label(work.rankName) +
              ' ・最高Rank ' + number(work.peakRank))
          );
          const received = work.receivedSeeds;
          const counts =
            received &&
            ['total', 'gold', 'silver', 'bronze', 'legacy'].every(
              (key) => Number.isSafeInteger(received[key]) && received[key] >= 0
            ) &&
            Number.isSafeInteger(
              received.gold +
                received.silver +
                received.bronze +
                received.legacy
            ) &&
            received.total ===
              received.gold +
                received.silver +
                received.bronze +
                received.legacy;
          info.append(
            el(
              'small',
              '',
              counts
                ? '受信 LIGHT SEED ' +
                    number(received.total) +
                    '個（GOLD ' +
                    number(received.gold) +
                    ' / SILVER ' +
                    number(received.silver) +
                    ' / BRONZE ' +
                    number(received.bronze) +
                    ' / 旧形式 ' +
                    number(received.legacy) +
                    '）'
                : '受信 LIGHT SEED：履歴照合中'
            )
          );
          row.append(info);
          workList.append(row);
        }
        if (!workList.children.length)
          workList.append(el('p', 'rr-muted', '自作品のRank履歴はありません。'));
        contents.append(workList);
        const eventList = el('div', 'rr-history');
        const titleByWorkId = new Map(
          latest.authorGrowth.works
            .filter((work) => work && typeof work.id === 'string')
            .map((work) => [work.id, work.title])
        );
        for (const event of latest.authorGrowth.events) {
          if (!event || !titleByWorkId.has(event.workId) ||
              !Number.isInteger(event.toRank) ||
              event.toRank < 1 || event.toRank > 6)
            continue;
          const type = {
            initial: '初回', promotion: '昇格',
            demotion: '降格', finalized: '確定'
          }[event.type];
          if (!type) continue;
          const row = el('div', 'rr-history-row');
          const info = el('div');
          info.append(
            el('strong', '', label(titleByWorkId.get(event.workId))),
            el('small', '',
              type + ' ・Rank ' + number(event.toRank) +
              ' ・' + safeDate(event.occurredAt))
          );
          row.append(info);
          eventList.append(row);
        }
        if (eventList.children.length) {
          contents.append(
            el('h3', '', '作品Rankの更新記録'),
            eventList
          );
        }
      }
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
      contents.append(
        el(
          'p',
          'rr-muted',
          '申請のキャンセルは未発行の確認後に予約を解除します。発行済みの特典は返還証拠の確認が必要です。確認前はPointを自動返却しません。'
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
      const requestId = ++lastReloadId;
      feedback.textContent = '';
      let result = null;
      try {
        result = await fetchSnapshot();
      } catch {
        // Missing, rejected or unverified snapshots all fail closed below.
      }
      if (requestId !== lastReloadId) return latest;
      latest = normalizeSnapshot(result);
      if (!latest.verified)
        feedback.textContent = '残高を取得できません。処理を停止しました。';
      refreshMetrics();
      selectTab(tab);
      return latest;
    }
    void reload();
    return Object.freeze({ reload, getSnapshot: () => latest });
  }
  globalThis.NovelightFormalScoutReward = Object.freeze({
    POINTS_PER_YEN,
    rankAtLevel,
    MIN_EXCHANGE_POINTS,
    normalizeSnapshot,
    createRewardReaderPanel
  });
})();
