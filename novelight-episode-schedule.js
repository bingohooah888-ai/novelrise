(function () {
  'use strict';

  const STYLE_ID = 'novelight-episode-schedule-style';
  const PANEL_ID = 'episodeSchedulePanel';

  function hasScheduleColumn() {
    return Boolean(
      typeof episode !== 'undefined' &&
        episode &&
        Object.prototype.hasOwnProperty.call(episode, 'scheduled_publish_at')
    );
  }

  function localDateTimeValue(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatLocal(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '未設定';
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .nl-schedule-panel{margin:0 0 20px;padding:16px;border:1px solid #d9ccb4;border-radius:10px;background:#fffdf7;color:#4f4334}
      .nl-schedule-title{font-size:14px;font-weight:900;margin-bottom:6px}.nl-schedule-copy{margin:0 0 12px;color:#756650;font-size:12px;line-height:1.7}
      .nl-schedule-current{margin:0 0 12px;padding:9px 11px;border-radius:8px;background:#f7f1e7;font-size:12px;font-weight:800}
      .nl-schedule-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:end}.nl-schedule-field label{display:block;margin-bottom:6px;font-size:12px;font-weight:900}
      .nl-schedule-field input{width:100%;padding:10px 11px;border:1px solid #d6d0c7;border-radius:8px;background:#fff;font:inherit}
      .nl-schedule-button{min-height:42px;padding:9px 13px;border:1px solid #5e4932;border-radius:8px;background:#5e4932;color:#fff;font:inherit;font-size:12px;font-weight:900;cursor:pointer;white-space:nowrap}
      .nl-schedule-button.secondary{background:#fff;color:#6a5740;border-color:#c8b99f}.nl-schedule-button:disabled{opacity:.55;cursor:not-allowed}
      @media(max-width:640px){.nl-schedule-row{grid-template-columns:1fr}.nl-schedule-button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function installPanel() {
    if (document.body.dataset.collaborationEditor === 'true') return false;
    if (!hasScheduleColumn() || !isDraft() || document.getElementById(PANEL_ID)) return false;
    const draftState = document.getElementById('draftState');
    if (!draftState) return false;

    installStyles();
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'nl-schedule-panel';
    panel.innerHTML = `
      <div class="nl-schedule-title">予約投稿</div>
      <p class="nl-schedule-copy">この下書きを指定日時に自動公開します。時刻はこの端末のタイムゾーンで入力し、サーバー側で約1分間隔に確認します。予約後も編集できますが、公開条件を満たさない内容へ変更した場合は予約が解除されます。</p>
      <div id="episodeScheduleCurrent" class="nl-schedule-current"></div>
      <div class="nl-schedule-row">
        <div class="nl-schedule-field"><label for="episodeScheduleAt">公開日時</label><input id="episodeScheduleAt" type="datetime-local" step="60"></div>
        <button id="episodeScheduleSave" class="nl-schedule-button" type="button">この日時に予約</button>
        <button id="episodeScheduleCancel" class="nl-schedule-button secondary" type="button">予約を解除</button>
      </div>`;
    draftState.insertAdjacentElement('afterend', panel);

    const input = document.getElementById('episodeScheduleAt');
    const scheduleButton = document.getElementById('episodeScheduleSave');
    const cancelButton = document.getElementById('episodeScheduleCancel');
    const current = document.getElementById('episodeScheduleCurrent');

    function render() {
      const scheduled = episode?.scheduled_publish_at || null;
      current.textContent = scheduled
        ? `予約中：${formatLocal(scheduled)} に自動公開予定`
        : '現在、予約投稿は設定されていません。';
      cancelButton.hidden = !scheduled;
      if (scheduled && !input.value) input.value = localDateTimeValue(scheduled);
      input.min = localDateTimeValue(new Date(Date.now() + 3 * 60 * 1000));
      input.max = localDateTimeValue(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
    }

    function setScheduleBusy(value) {
      scheduleButton.disabled = value;
      cancelButton.disabled = value;
      input.disabled = value;
      setBusy(value);
    }

    scheduleButton.addEventListener('click', async () => {
      if (!ready || busy || !isDraft()) return;
      const requested = new Date(input.value);
      if (!input.value || !Number.isFinite(requested.getTime())) {
        status.textContent = '予約する公開日時を入力してください。';
        return;
      }
      if (requested.getTime() < Date.now() + 2 * 60 * 1000) {
        status.textContent = '予約日時は現在より2分以上先に設定してください。';
        return;
      }
      if (requested.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
        status.textContent = '予約日時は1年以内に設定してください。';
        return;
      }

      const value = values();
      const validation = validate(value, true);
      if (validation) {
        status.textContent = validation;
        return;
      }

      setScheduleBusy(true);
      status.textContent = '最新の下書きを保存して予約しています...';
      try {
        await saveServerDraft();
        const result = await client.rpc('novelight_schedule_episode_draft', {
          p_episode_id: id,
          p_publish_at: requested.toISOString()
        });
        if (result.error) throw result.error;
        episode.scheduled_publish_at = result.data || requested.toISOString();
        window.NovelightAuthorDraft?.clearCurrentDraft?.();
        status.textContent = `${formatLocal(episode.scheduled_publish_at)} に予約しました。`;
        render();
      } catch (error) {
        console.error(error);
        status.textContent = '予約できませんでした。日時と公開条件を確認して、もう一度お試しください。';
      } finally {
        setScheduleBusy(false);
      }
    });

    cancelButton.addEventListener('click', async () => {
      if (!ready || busy || !isDraft() || !episode?.scheduled_publish_at) return;
      setScheduleBusy(true);
      status.textContent = '予約を解除しています...';
      try {
        const result = await client.rpc('novelight_cancel_episode_schedule', {
          p_episode_id: id
        });
        if (result.error) throw result.error;
        episode.scheduled_publish_at = null;
        status.textContent = '予約投稿を解除しました。下書きはそのまま保存されています。';
        render();
      } catch (error) {
        console.error(error);
        status.textContent = '予約を解除できませんでした。時間をおいて再度お試しください。';
      } finally {
        setScheduleBusy(false);
      }
    });

    render();
    return true;
  }

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (typeof ready !== 'undefined' && ready) {
      window.clearInterval(timer);
      installPanel();
      return;
    }
    if (attempts >= 100) window.clearInterval(timer);
  }, 100);
})();