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

  const style = document.createElement('style');
  style.id = 'novelight-beta-auto-seed-style';
  style.textContent =
    '.seed-types[data-auto-tier="true"]{grid-template-columns:minmax(0,360px)}' +
    '.seed-choice.auto-tier{min-height:58px;text-align:center;align-items:center;background:#fff;border-color:#9b89e8}' +
    '.seed-classification-notice{margin-top:12px;padding:10px 12px;border:1px solid #ddd7ff;border-radius:9px;background:#fff;color:#425260;font-size:12px;line-height:1.7;font-weight:700}' +
    '.seed-classification-notice .seed-info-line{display:block}' +
    '.seed-classification-notice .seed-info-line+.seed-info-line{margin-top:2px}' +
    '#lightSeedArea .seed-notice{color:#344254;font-weight:700}';
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
  if (oldNotice) oldNotice.textContent = '対象作品を実際に読んだ記録がある場合のみ送信できます。';

  if (!area.querySelector('.seed-classification-notice')) {
    const notice = document.createElement('p');
    notice.className = 'seed-classification-notice';
    const lines = [
      '作品は内部的に区分されており、その区分に応じて使用されるLIGHT SEEDが自動で切り替わります。これは不具合ではなく仕様です。',
      '自分の作品には贈れません。',
      '送信後の取消はできません。',
      '対象作品を実際に読んだ記録がある場合のみ送信できます。'
    ];
    for (const text of lines) {
      const line = document.createElement('span');
      line.className = 'seed-info-line';
      line.textContent = text;
      notice.appendChild(line);
    }
    types.insertAdjacentElement('afterend', notice);
  }

  const api = window.supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );
  let status = null;
  let sendResultMessage = '';

  function setDisabled(disabled) {
    button.disabled = Boolean(disabled);
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
    remaining.textContent = value?.monthly_limit
      ? `今月あと ${Number(value.remaining_this_month || 0)}/${Number(value.monthly_limit)}`
      : '';
    total.textContent = `この作品のLIGHT SEED ${Number(value?.total_seed_count || 0)}`;
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
    try {
      await refreshAutoSeed();
    } catch (error) {
      console.error('Automatic LIGHT SEED status unavailable', error);
      status = null;
      message.hidden = false;
      message.textContent = 'LIGHT SEED新仕様の準備中です。現在は送信できません。';
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
