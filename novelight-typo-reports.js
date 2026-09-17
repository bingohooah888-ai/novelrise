(() => {
  function unavailable(error) {
    const message = String(error?.message || '');
    return (
      error?.code === 'PGRST202' ||
      error?.code === '42883' ||
      message.includes('novelight_typo_report_state') ||
      message.includes('Could not find the function')
    );
  }

  function codePointLength(value) {
    return Array.from(String(value || '')).length;
  }

  function selectionInside(body) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const startNode =
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer;
    const endNode =
      range.endContainer.nodeType === Node.TEXT_NODE
        ? range.endContainer.parentElement
        : range.endContainer;
    if (!startNode || !endNode || !body.contains(startNode) || !body.contains(endNode)) return null;

    const original = range.toString();
    if (codePointLength(original) < 1 || codePointLength(original) > 200) return null;

    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(body);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    return {
      original,
      startChar: codePointLength(prefixRange.toString()) + 1
    };
  }

  function makeModal() {
    let modal = document.getElementById('typoReportModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'typoReportModal';
    modal.className = 'typo-report-modal';
    modal.innerHTML = [
      '<section class="typo-report-card" role="dialog" aria-modal="true" aria-labelledby="typoReportTitle">',
      '<h2 id="typoReportTitle">誤字・脱字を作者へ報告</h2>',
      '<p class="typo-report-help">本文で選択した箇所と修正案だけを作者へ送ります。本文は自動では変更されず、作者が差分を確認して採用した場合だけ反映されます。</p>',
      '<div class="typo-report-field"><span class="typo-report-label">選択した本文</span><div id="typoOriginal" class="typo-report-original"></div></div>',
      '<label class="typo-report-field"><span class="typo-report-label">修正案</span><textarea id="typoReplacement" maxlength="200" placeholder="削除する場合は空欄のまま送信できます。"></textarea></label>',
      '<div id="typoReportStatus" class="typo-report-status" aria-live="polite"></div>',
      '<div class="typo-report-actions"><button id="typoCancel" type="button">キャンセル</button><button id="typoSend" class="primary" type="button">作者へ送る</button></div>',
      '</section>'
    ].join('');
    document.body.appendChild(modal);
    return modal;
  }

  function loginRedirect() {
    const target =
      (window.location.pathname.split('/').pop() || 'episode.html') +
      window.location.search;
    window.location.href = 'login.html?redirect=' + encodeURIComponent(target);
  }

  function errorMessage(error) {
    const message = String(error?.message || '');
    if (message.includes('TYPO_REPORTS_DISABLED')) {
      return 'この作品では現在、誤字報告を受け付けていません。';
    }
    if (message.includes('Selected text no longer matches')) {
      return '本文が更新されたため送信できません。現在の本文を選び直してください。';
    }
    if (
      message.includes('limit reached') ||
      message.includes('inbox is full') ||
      error?.code === 'P0001'
    ) {
      return '短時間に送信できる件数を超えました。時間をおいてお試しください。';
    }
    return '送信できませんでした。時間をおいて再度お試しください。';
  }

  async function mount({ client, episode, session, isAuthor }) {
    if (!client || !episode || isAuthor) return;

    let state;
    try {
      state = await client.rpc('novelight_typo_report_state', {
        p_episode_id: Number(episode.id)
      });
      if (state.error) {
        if (unavailable(state.error)) return;
        throw state.error;
      }
    } catch (error) {
      console.error('typo report state unavailable', error);
      return;
    }

    if (state.data?.enabled !== true) return;

    const meta = document.querySelector('#card .meta');
    const body = document.querySelector('#card .content');
    const policyReportButton = document.getElementById('report');
    if (!meta || !body || document.getElementById('typoReportButton')) return;

    const button = document.createElement('button');
    button.id = 'typoReportButton';
    button.className = 'action typo-report-action';
    button.type = 'button';
    button.textContent = '誤字を報告';
    button.title = '本文の修正したい箇所を選択してから押してください';
    meta.insertBefore(button, policyReportButton || null);

    const modal = makeModal();
    const originalEl = modal.querySelector('#typoOriginal');
    const replacementEl = modal.querySelector('#typoReplacement');
    const statusEl = modal.querySelector('#typoReportStatus');
    const sendButton = modal.querySelector('#typoSend');
    const cancelButton = modal.querySelector('#typoCancel');
    let selected = null;

    function close() {
      modal.classList.remove('visible');
      selected = null;
      statusEl.textContent = '';
      replacementEl.value = '';
    }

    cancelButton.onclick = close;
    modal.addEventListener('click', event => {
      if (event.target === modal) close();
    });

    button.onclick = () => {
      if (!session) {
        loginRedirect();
        return;
      }

      selected = selectionInside(body);
      if (!selected) {
        button.textContent = '本文を選択してください';
        setTimeout(() => {
          if (button.isConnected) button.textContent = '誤字を報告';
        }, 1800);
        return;
      }

      originalEl.textContent = selected.original;
      replacementEl.value = selected.original;
      statusEl.textContent = '';
      modal.classList.add('visible');
      replacementEl.focus();
      replacementEl.select();
    };

    sendButton.onclick = async () => {
      if (!selected || !session) return;
      const replacement = replacementEl.value;
      if (codePointLength(replacement) > 200) {
        statusEl.textContent = '修正案は200文字以内で入力してください。';
        return;
      }
      if (replacement === selected.original) {
        statusEl.textContent = '修正前と異なる内容を入力してください。';
        return;
      }

      sendButton.disabled = true;
      statusEl.textContent = '送信しています…';
      try {
        const result = await client.rpc('novelight_submit_typo_report', {
          p_episode_id: Number(episode.id),
          p_start_char: selected.startChar,
          p_original_text: selected.original,
          p_replacement_text: replacement
        });
        if (result.error) throw result.error;

        if (result.data?.status === 'duplicate') {
          statusEl.textContent = '同じ箇所・同じ修正案はすでに報告されています。';
          return;
        }

        statusEl.textContent = '作者へ送信しました。本文が自動で変更されることはありません。';
        setTimeout(close, 1200);
      } catch (error) {
        console.error('typo report submit failed', error);
        statusEl.textContent = errorMessage(error);
      } finally {
        sendButton.disabled = false;
      }
    };
  }

  window.NovelightTypoReports = { mount };
})();
