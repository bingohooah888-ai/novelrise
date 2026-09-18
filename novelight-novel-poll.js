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
