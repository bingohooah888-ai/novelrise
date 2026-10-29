(() => {
  const API_MISSING_CODES = new Set(['42883', 'PGRST202']);

  function apiUnavailable(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    return API_MISSING_CODES.has(code)
      || message.includes('novelight_public_novel_poll')
      || message.includes('novelight_vote_novel_poll')
      || message.includes('Could not find the function')
      || message.includes('does not exist');
  }

  function reasonText(reason) {
    const messages = {
      eligible: '1つ選んで投票できます。投票後は現在の集計を確認できます。',
      login_required: '投票するにはログインが必要です。選択肢を押すとログイン画面へ進みます。',
      own_novel: '作者本人は自作品のアンケートへ投票できません。集計は作者管理画面で確認できます。',
      blocked: 'ブロック中の相手とはアンケートで直接交流できません。',
      already_voted: '投票済みです。現在の集計を表示しています。',
      closed: 'このアンケートは終了しました。最終集計を表示しています。'
    };
    return messages[reason] || '現在このアンケートには投票できません。';
  }

  function createOption(poll, option, onVote) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'novelight-poll-option';
    const selected = Number(poll.viewer_option_id) === Number(option.id);
    if (selected) button.classList.add('selected');
    const row = document.createElement('span');
    row.className = 'novelight-poll-row';
    const label = document.createElement('span');
    label.textContent = option.label;
    row.appendChild(label);

    const count = option.vote_count == null ? null : Number(option.vote_count);
    if (count != null) {
      const countLabel = document.createElement('span');
      countLabel.textContent = `${count.toLocaleString()}票`;
      row.appendChild(countLabel);
    }
    button.appendChild(row);

    if (count != null) {
      const total = Math.max(Number(poll.total_votes || 0), 0);
      const percent = total > 0 ? Math.round((count / total) * 100) : 0;
      const meter = document.createElement('span');
      meter.className = 'novelight-poll-result';
      const fill = document.createElement('span');
      fill.style.width = `${percent}%`;
      meter.appendChild(fill);
      button.appendChild(meter);
    }

    const clickable = poll.vote_reason === 'eligible' || poll.vote_reason === 'login_required';
    button.disabled = !clickable;
    button.addEventListener('click', () => onVote(option.id));
    return button;
  }
  function render(area, poll, onVote) {
    area.replaceChildren();
    if (!poll) {
      area.hidden = true;
      return;
    }

    area.hidden = false;
    const kicker = document.createElement('div');
    kicker.className = 'novelight-poll-kicker';
    kicker.textContent = 'READER POLL';
    const heading = document.createElement('h2');
    heading.textContent = poll.question;

    const note = document.createElement('p');
    note.className = 'novelight-poll-note';
    note.textContent = '作者から読者への簡易アンケートです。投票数は作品Rank・LIGHT SEED・SCOUT・露出には影響しません。';

    const options = document.createElement('div');
    options.className = 'novelight-poll-options';
    for (const option of Array.isArray(poll.options) ? poll.options : []) {
      options.appendChild(createOption(poll, option, onVote));
    }

    const status = document.createElement('p');
    status.className = 'novelight-poll-status';
    const total = poll.total_votes == null ? '' : ` 合計 ${Number(poll.total_votes).toLocaleString()}票。`;
    status.textContent = reasonText(poll.vote_reason) + total;

    area.append(kicker, heading, note, options, status);
  }
  async function mount(client, novel, session) {
    const area = document.getElementById('novelPollArea');
    if (!area || !client || !novel || novel.status !== 'published') {
      if (area) area.hidden = true;
      return;
    }

    async function loadPoll() {
      const result = await client.rpc('novelight_public_novel_poll', {
        p_novel_id: Number(novel.id)
      });
      if (result.error) throw result.error;
      return result.data || null;
    }

    async function refresh() {
      try {
        const poll = await loadPoll();
        render(area, poll, async optionId => {
          if (!poll) return;
          if (poll.vote_reason === 'login_required') {
            window.location.href = 'login.html?redirect='
              + encodeURIComponent(`novel.html?id=${novel.id}`);
            return;
          }
          if (poll.vote_reason !== 'eligible') return;

          const buttons = Array.from(area.querySelectorAll('button'));
          buttons.forEach(button => { button.disabled = true; });
          try {
            const vote = await client.rpc('novelight_vote_novel_poll', {
              p_poll_id: Number(poll.poll_id),
              p_option_id: Number(optionId)
            });
            if (vote.error) throw vote.error;
            await refresh();
          } catch (error) {
            console.error('Reader poll vote failed', error);
            alert('投票できませんでした。状態を確認してもう一度お試しください。');
            await refresh();
          }
        });
      } catch (error) {
        if (!apiUnavailable(error)) {
          console.error('Reader poll unavailable', error);
        }
        area.hidden = true;
        area.replaceChildren();
      }
    }

    void session;
    await refresh();
  }

  window.NovelightNovelPoll = { mount };
})();

// Beta novel-detail cutover for LIGHT SEED.
// This lives beside the novel-detail runtime so the existing inline page can be
// cut over without exposing the private Rank contract to the browser.
window.setTimeout(() => {
  const page = (window.location.pathname.split('/').pop() || '').toLowerCase();
  if (page !== 'novel.html' && page !== 'novel') return;

  const area = document.getElementById('lightSeedArea');
  const types = document.getElementById('seedTypes');
  const message = document.getElementById('seedMessage');
  const remaining = document.getElementById('seedRemaining');
  const total = document.getElementById('seedTotal');
  if (!area || !types || !message || !remaining || !total || !window.supabase) return;

  const novelId = new URLSearchParams(window.location.search).get('id');
  if (!novelId) return;

  const lightSeedHelpPoints = [
    'GOLD / SILVER / BRONZEの3種類があります。',
    '作品は内部的に区分されており、その区分に応じて使用されるLIGHT SEEDが自動で切り替わります。これは不具合ではなく仕様です。',
    '自分の作品には贈れません。',
    '送信後の取消はできません。',
    '対象作品を実際に読んだ記録がある場合のみ送信できます。',
    '同じ読者が同じ作品へ贈れるLIGHT SEEDは1回です。種類変更・再取得はできません。',
    'LIGHT SEEDの送信・発掘実績はSCOUT RECORDの活動記録や成長要素と関係します。',
    '作者の知名度や人間関係ではなく、作品を見つけた読者の発掘体験を残すための仕組みです。'
  ];

  function syncLightSeedHelpTopic() {
    const topic = window.NovelightHelp?.topics?.['light-seed'];
    if (!topic) return false;
    topic.points = lightSeedHelpPoints.slice();
    return true;
  }

  if (!syncLightSeedHelpTopic()) {
    let helpSyncAttempts = 0;
    const helpSyncTimer = window.setInterval(() => {
      helpSyncAttempts += 1;
      if (syncLightSeedHelpTopic() || helpSyncAttempts >= 50) {
        window.clearInterval(helpSyncTimer);
      }
    }, 100);
  }

  const style = document.createElement('style');
  style.id = 'novelight-beta-auto-seed-style';
  style.textContent = `
    .nl-work-support-stack #lightSeedArea.nl-work-seed-inline{padding:18px 10px}
    #lightSeedArea.nl-work-seed-inline{padding-inline:10px}
    #lightSeedArea.nl-work-seed-inline .seed-top{margin-bottom:12px}
    #lightSeedArea .seed-notice{color:#182b3c;font-weight:700}
    .light-seed-content-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.47fr);gap:10px;align-items:stretch;width:100%;box-sizing:border-box}
    .light-seed-content-grid>*{min-width:0}
    .light-seed-public-summary{display:flex;align-items:center;gap:10px;margin:0;max-width:none;min-height:116px;height:100%;box-sizing:border-box;padding:12px;border:1px solid #e4dac9;border-radius:12px;background:#fff}
    .light-seed-public-summary img{width:50px;height:50px;object-fit:contain;flex:none;border-radius:8px}
    .light-seed-public-summary .light-seed-public-label{display:block;color:#61564d;font-size:12px;font-weight:700;line-height:1.5}
    .light-seed-public-summary strong{display:block;color:#34271e;font-size:22px;line-height:1.5}
    .light-seed-content-grid #seedTypes.seed-types[data-auto-tier="true"]{display:block;align-self:stretch;margin:0;min-width:0;grid-template-columns:none}
    .light-seed-content-grid #sendLightSeedButton.seed-choice.auto-tier{width:100%;height:100%;min-height:116px;box-sizing:border-box;padding:12px 10px;display:flex;align-items:center;justify-content:center;text-align:center;gap:6px;background:#fff;border-color:#9b89e8}
    .light-seed-content-grid #sendLightSeedButton .seed-choice-internal-note{display:block;max-width:100%;font-size:11px;font-weight:700;line-height:1.5;color:#35495f;white-space:normal}
    .light-seed-reader-inventory{display:grid;grid-template-columns:minmax(85px,1fr) repeat(3,minmax(0,1.15fr));align-items:center;gap:6px;padding:12px 10px;border:1px solid #dfc8a5;border-radius:12px;background:#fffdfa;min-width:0;min-height:116px;height:100%;box-sizing:border-box}
    .light-seed-reader-inventory[hidden]{display:none!important}
    .light-seed-reader-inventory-heading{display:grid;gap:5px;min-width:0;color:#72501f}
    .light-seed-reader-inventory-heading span{font-size:12px;font-weight:900;letter-spacing:.03em;white-space:nowrap}
    .light-seed-reader-inventory-heading strong{font-size:19px;line-height:1.4;white-space:nowrap}
    .light-seed-reader-inventory-tier{display:flex;align-items:center;justify-content:center;gap:4px;min-width:0}
    .light-seed-reader-inventory-tier img{display:block;flex:none;width:38px;height:38px;object-fit:contain}
    .light-seed-reader-inventory-tier div{display:grid;gap:3px;min-width:0}
    .light-seed-reader-inventory-tier span{font-size:11px;letter-spacing:.025em;line-height:1.2;color:#695340}
    .light-seed-reader-inventory-tier strong{font-size:14px;line-height:1.3;font-weight:900;white-space:nowrap;color:#27354a}
    .light-seed-compat-stats{display:none!important}
    .light-seed-content-grid:has(>.light-seed-reader-inventory[hidden]){grid-template-columns:repeat(2,minmax(0,1fr))}
    @media(max-width:1080px){
      .light-seed-content-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      .light-seed-content-grid>.light-seed-reader-inventory{grid-column:1/-1}
    }
    @media(max-width:650px){
      .light-seed-content-grid,.light-seed-content-grid:has(>.light-seed-reader-inventory[hidden]){grid-template-columns:minmax(0,1fr)}
      .light-seed-content-grid>.light-seed-reader-inventory{grid-column:auto}
      .light-seed-reader-inventory{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 4px}
      .light-seed-reader-inventory-heading{grid-column:1/-1;display:flex;justify-content:space-between}
      .light-seed-reader-inventory-tier{flex-direction:column;text-align:center;gap:4px}
      .light-seed-reader-inventory-tier img{width:34px;height:34px}
    }
  `;
  document.head.appendChild(style);

  types.dataset.autoTier = 'true';
  types.setAttribute('aria-label', 'LIGHT SEEDを贈る');
  types.innerHTML =
    '<button id="sendLightSeedButton" class="seed-choice auto-tier" type="button" disabled>' +
      '<span class="seed-choice-name">LIGHT SEEDを贈る</span>' +
      '<span class="seed-choice-count">種類は作品の内部区分に応じて自動決定</span>' +
    '</button>' +
    '<span id="goldRemaining" hidden></span><span id="silverRemaining" hidden></span><span id="bronzeRemaining" hidden></span>';

  const button = document.getElementById('sendLightSeedButton');
  const oldNotice = area.querySelector('.seed-notice');
  const sendNote = document.createElement('span');
  sendNote.className = 'seed-choice-internal-note';
  sendNote.textContent = '対象作品を実際に読んだ記録がある場合のみ送信できます。';
  button.appendChild(sendNote);
  oldNotice?.remove();

  // Public works show the received total, never their hidden Rank or tier distribution.
  // The detailed GOLD/SILVER/BRONZE inventory stays in the owner's existing panel.
  const publicSummary = document.createElement('div');
  publicSummary.className = 'light-seed-public-summary';
  publicSummary.innerHTML =
    '<img src="assets/novelight-feature-light-seed.webp" alt="" width="54" height="54" loading="lazy" decoding="async">' +
    '<div><span class="light-seed-public-label">この作品が受け取ったLIGHT SEED</span>' +
    '<strong id="publicLightSeedCount" aria-live="polite">確認中…</strong></div>';
  types.insertAdjacentElement('beforebegin', publicSummary);
  const publicCount = document.getElementById('publicLightSeedCount');
  total.hidden = true;

  // Personal reader inventory: separate from the public work-received total.
  const readerInventory = document.createElement('aside');
  readerInventory.className = 'light-seed-reader-inventory';
  readerInventory.setAttribute('aria-label', 'あなたのLIGHT SEED残数');
  readerInventory.hidden = true;
  readerInventory.innerHTML =
    '<div class="light-seed-reader-inventory-heading">' +
      '<span>LIGHT SEED</span><strong id="novelReaderSeedTotal" aria-live="polite">確認中…</strong>' +
    '</div>' +
    [
      ['Gold', 'GOLD', 'gold'],
      ['Silver', 'SILVER', 'silver'],
      ['Bronze', 'BRONZE', 'bronze']
    ].map(([label, title, key]) =>
      '<div class="light-seed-reader-inventory-tier">' +
        '<img src="assets/scout-record/light-seed/light_seed_' + key + '.png" alt="" width="40" height="40" loading="lazy" decoding="async">' +
        '<div><span>' + title + '</span><strong id="novelReaderSeed' + label + '">—</strong></div>' +
      '</div>'
    ).join('');
  const seedLayout = document.createElement('div');
  seedLayout.className = 'light-seed-content-grid';
  seedLayout.append(publicSummary, types, readerInventory);
  area.classList.add('nl-work-seed-inline');
  area.appendChild(seedLayout);
  // Keep legacy compatibility nodes for old consumers, never show duplicate
  // monthly inventory numbers below the three visible cards.
  const legacyStats = area.querySelector('.seed-stats');
  if (legacyStats) {
    legacyStats.classList.add('light-seed-compat-stats');
    legacyStats.hidden = true;
  }
  remaining.hidden = true;
  remaining.textContent = '';

  const api = window.supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );
  let status = null;
  let sendResultMessage = '';

  function setDisabled(disabled) {
    button.disabled = Boolean(disabled);
  }

  // Use the existing authenticated/self-scoped inventory RPC (also used by the bookshelf).
  async function refreshReaderInventory() {
    try {
      const auth = await api.auth.getSession();
      if (auth.error) throw auth.error;
      if (!auth.data?.session?.user?.id) {
        readerInventory.hidden = true;
        return;
      }
      readerInventory.hidden = false;
      const result = await api.rpc('novelight_light_seed_inventory');
      if (result.error) throw result.error;
      const value = result.data;
      const numbers = [
        value?.remaining_this_month, value?.monthly_limit,
        value?.gold_remaining, value?.gold_allocated,
        value?.silver_remaining, value?.silver_allocated,
        value?.bronze_remaining, value?.bronze_allocated
      ];
      if (numbers.some((number) => number === null || number === undefined || !Number.isFinite(Number(number)))) {
        throw new Error('LIGHT SEED inventory response missing numeric fields');
      }
      const format = (number) => Math.max(0, Number(number)).toLocaleString('ja-JP');
      document.getElementById('novelReaderSeedTotal').textContent =
        format(value.remaining_this_month) + ' / ' + format(value.monthly_limit);
      for (const [label, key] of [['Gold', 'gold'], ['Silver', 'silver'], ['Bronze', 'bronze']]) {
        document.getElementById('novelReaderSeed' + label).textContent =
          format(value[key + '_remaining']) + ' / ' + format(value[key + '_allocated']);
      }
    } catch (error) {
      if (!readerInventory.hidden) {
        document.getElementById('novelReaderSeedTotal').textContent = '取得できません';
        for (const label of ['Gold', 'Silver', 'Bronze']) {
          document.getElementById('novelReaderSeed' + label).textContent = '—';
        }
      }
      console.warn('Reader LIGHT SEED inventory unavailable');
    }
  }

  function renderStatus(value) {
    status = value || null;
    area.classList.add('visible');
    const messages = {
      eligible: 'この作品にLIGHT SEEDを贈れます。使用される種類は作品の内部区分に応じて自動で決まります。',
      login_required: 'LIGHT SEEDを贈るにはログインが必要です。',
      own_novel: '自分の作品には贈れません。',
      already_seeded: 'この作品にはすでにLIGHT SEEDを贈っています。',
      valid_read_required: 'LIGHT SEEDを贈るには、この作品のエピソードを実際に読む必要があります。',
      monthly_limit_reached: '今月のLIGHT SEEDを使い切りました。',
      required_seed_unavailable: 'この作品に使用されるLIGHT SEEDは今月分を使い切っています。'
    };
    message.hidden = value?.reason === 'own_novel';
    message.textContent = sendResultMessage || messages[value?.reason] || '現在LIGHT SEEDを利用できません。';
    sendResultMessage = '';
    remaining.textContent = '';
    const receivedCount = Math.max(0, Number(value?.total_seed_count) || 0);
    publicCount.textContent = `${receivedCount.toLocaleString('ja-JP')} 個`;
    total.textContent = `この作品のLIGHT SEED ${receivedCount}`;
    setDisabled(!['eligible', 'login_required'].includes(value?.reason));
  }

  async function refreshAutoSeed() {
    const result = await api.rpc('light_seed_status_auto_v1', {
      p_novel_id: String(novelId)
    });
    if (result.error) throw result.error;
    renderStatus(result.data);
    return result.data;
  }

  async function sendAutoSeed() {
    if (!status) return;
    if (status.reason === 'login_required') {
      window.location.href = 'login.html?redirect=' + encodeURIComponent(`novel.html?id=${novelId}`);
      return;
    }
    if (status.reason !== 'eligible') return;

    const ok = window.confirm(
      'LIGHT SEEDをこの作品に贈りますか？\n' +
      '作品の内部区分に応じた種類が自動で使用されます。\n' +
      '送信後の取消はできません。'
    );
    if (!ok) return;

    setDisabled(true);
    try {
      const result = await api.rpc('plant_light_seed_auto_v1', {
        p_novel_id: String(novelId)
      });
      if (result.error) throw result.error;
      sendResultMessage = `${String(result.data?.seed_type || 'LIGHT SEED')}を贈りました。`;
      void window.NovelightClient?.recordJourney?.(api, 'light_seed', novelId);
      await refreshAutoSeed();
      void refreshReaderInventory();
    } catch (error) {
      console.error('Automatic LIGHT SEED send failed', error);
      window.alert('LIGHT SEEDを贈れませんでした。作品を読んだ後、状態を確認してもう一度お試しください。');
      try {
        await refreshAutoSeed();
      } catch (refreshError) {
        console.error('Automatic LIGHT SEED refresh failed', refreshError);
        setDisabled(true);
      }
    }
  }

  async function setupAutoSeed() {
    area.classList.add('visible');
    button.onclick = () => void sendAutoSeed();
    void refreshReaderInventory();
    try {
      await refreshAutoSeed();
    } catch (error) {
      console.error('Automatic LIGHT SEED status unavailable', error);
      status = null;
      message.hidden = false;
      message.textContent = 'LIGHT SEEDの状態を取得できませんでした。再読み込みしてお試しください。';
      publicCount.textContent = '取得できません';
      remaining.textContent = '';
      total.textContent = '';
      setDisabled(true);
    }
  }

  // Override the legacy page globals before its async load normally reaches
  // LIGHT SEED setup. Hidden compatibility spans above keep an already-started
  // legacy refresh harmless during the short beta cutover window.
  window.seedButtons = () => [button];
  window.setSeedButtonsDisabled = setDisabled;
  window.renderSeed = renderStatus;
  window.refreshSeed = refreshAutoSeed;
  window.sendSeed = sendAutoSeed;
  window.setupSeed = setupAutoSeed;

  void setupAutoSeed();
}, 0);

(function attachEpisodeNumberVisibilityToNovel(global) {
  'use strict';

  const poll = global.NovelightNovelPoll;
  if (!poll?.mount) return;
  const baseMount = poll.mount;

  function installStyle() {
    if (document.getElementById('novelight-episode-number-visibility-style')) return;
    const style = document.createElement('style');
    style.id = 'novelight-episode-number-visibility-style';
    style.textContent =
      '.novelight-hide-auto-episode-numbers #episodeList .episode-number{display:none!important}';
    document.head.appendChild(style);
  }

  async function applyVisibility(client, novel) {
    const novelId = Number(novel?.id);
    if (!client || !Number.isSafeInteger(novelId) || novelId <= 0) return;
    const result = await client
      .from('novels')
      .select('show_episode_numbers')
      .eq('id', novelId)
      .maybeSingle();
    if (result.error) {
      const text = String(result.error?.message || '');
      if (!text.includes('show_episode_numbers')) {
        console.error('episode number visibility unavailable', result.error);
      }
      return;
    }
    installStyle();
    document.documentElement.classList.toggle(
      'novelight-hide-auto-episode-numbers',
      result.data?.show_episode_numbers === false
    );
  }

  async function mountWithEpisodeNumberVisibility(client, novel, session) {
    const visibility = applyVisibility(client, novel).catch((error) => {
      console.error('episode number visibility failed', error);
    });
    const result = await baseMount(client, novel, session);
    await visibility;
    return result;
  }

  global.NovelightNovelPoll = {
    ...poll,
    mount: mountWithEpisodeNumberVisibility
  };
})(globalThis);
