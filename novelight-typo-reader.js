(() => {
  let mounted = false;
  let proposal = null;

  const make = (tag, text, className) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };

  function buildModal() {
    const overlay = make('div', undefined, 'modal');
    overlay.id = 'typoModal';
    const card = make('section', undefined, 'modal-card');
    const title = make('h2', '誤字報告');
    const copy = make(
      'p',
      '本文から選択した箇所について、作者へ修正案を送ります。本文には自動反映されません。'
    );
    copy.style.color = '#666';
    copy.style.fontSize = '13px';
    copy.style.marginTop = '7px';

    const original = make('div', '', 'typo-selection');
    original.id = 'typoOriginal';

    const replacement = document.createElement('textarea');
    replacement.id = 'typoReplacement';
    replacement.maxLength = 500;
    replacement.placeholder =
      '修正後の文字列。削除の場合は空欄のまま送信できます。';

    const actions = make('div', undefined, 'modal-actions');
    const cancel = make('button', 'キャンセル');
    cancel.id = 'typoCancel';
    cancel.type = 'button';
    const send = make('button', '作者へ送信', 'send');
    send.id = 'typoSend';
    send.type = 'button';
    actions.append(cancel, send);

    const status = make('div', '', 'status');
    status.id = 'typoStatus';

    card.append(title, copy, original, replacement, actions, status);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    return { overlay, original, replacement, cancel, send, status };
  }

  async function mount() {
    if (mounted || typeof client === 'undefined' || !episode || !novel) return;
    const meta = document.querySelector('#card .meta');
    const contentRoot = document.querySelector('#card .content');
    if (!meta || !contentRoot) return;
    if (isAuthor) {
      mounted = true;
      return;
    }

    const setting = await client
      .from('novels')
      .select('typo_reports_enabled')
      .eq('id', novel.id)
      .maybeSingle();

    if (setting.error || !setting.data || setting.data.typo_reports_enabled === false) {
      mounted = true;
      return;
    }

    const button = make('button', '誤字報告', 'action typo');
    button.id = 'typoReport';
    button.type = 'button';
    meta.insertBefore(button, document.getElementById('report'));

    const ui = buildModal();

    const close = () => {
      ui.overlay.classList.remove('visible');
      proposal = null;
      ui.replacement.value = '';
      ui.status.textContent = '';
    };

    button.addEventListener('click', () => {
      if (!session) {
        location.href =
          'login.html?redirect=' +
          encodeURIComponent('episode.html?id=' + String(episode.id));
        return;
      }

      const captured = NovelightTypoReports.captureSelection(contentRoot);
      if (!captured.ok) {
        window.alert(captured.message);
        return;
      }

      proposal = captured;
      ui.original.textContent = captured.originalText;
      ui.replacement.value = captured.originalText;
      ui.status.textContent = '';
      ui.overlay.classList.add('visible');
      ui.replacement.focus();
      ui.replacement.select();
    });

    ui.cancel.addEventListener('click', close);
    ui.send.addEventListener('click', async () => {
      if (!proposal) {
        ui.status.textContent = '本文の対象箇所を選択し直してください。';
        return;
      }

      const replacement = ui.replacement.value;
      if (replacement === proposal.originalText) {
        ui.status.textContent = '修正案は元の文字列と異なる内容にしてください。';
        return;
      }

      ui.send.disabled = true;
      ui.status.textContent = '送信中...';

      try {
        const result = await client.rpc('novelight_submit_episode_typo_report', {
          p_episode_id: Number(episode.id),
          p_source_start: proposal.sourceStart,
          p_original_text: proposal.originalText,
          p_replacement_text: replacement
        });
        if (result.error) throw result.error;
        ui.status.textContent = '作者へ誤字報告を送りました。';
        setTimeout(close, 700);
      } catch (error) {
        console.error('typo report submit failed', error);
        const message = String(error?.message || '');
        if (message.includes('TYPO_REPORTS_DISABLED')) {
          ui.status.textContent = 'この作品では現在、誤字報告を受け付けていません。';
        } else if (message.includes('TYPO_SOURCE_CHANGED')) {
          ui.status.textContent =
            '本文が更新されたため、対象箇所を選択し直してください。';
        } else if (message.includes('TYPO_REPORT_DUPLICATE')) {
          ui.status.textContent = '同じ修正案はすでに送信済みです。';
        } else if (
          message.includes('TYPO_REPORT_RATE_LIMIT') ||
          message.includes('TYPO_REPORT_EPISODE_LIMIT')
        ) {
          ui.status.textContent =
            '短時間の送信上限に達しました。時間をおいてお試しください。';
        } else if (message.includes('DIRECT_INTERACTION_UNAVAILABLE')) {
          ui.status.textContent = 'この作者への誤字報告は利用できません。';
        } else {
          ui.status.textContent = '誤字報告を送信できませんでした。';
        }
      } finally {
        ui.send.disabled = false;
      }
    });

    mounted = true;
  }

  const style = document.createElement('style');
  style.textContent =
    '.typo{background:#fff8e9!important;color:#674f2f!important;border:1px solid #d8c6a8!important}.typo-selection{margin-top:10px;padding:10px;border-radius:8px;background:#f7f8fb;white-space:pre-wrap;word-break:break-word;font-size:13px;max-height:160px;overflow:auto}';
  document.head.appendChild(style);

  const observer = new MutationObserver(() => {
    void mount();
    if (mounted) observer.disconnect();
  });
  observer.observe(document.getElementById('card'), {
    childList: true,
    subtree: true
  });
  void mount();
})();
