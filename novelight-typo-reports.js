(() => {
  const missingRpc = error => {
    const message = String(error?.message || '');
    return error?.code === 'PGRST202' || error?.code === '42883' || message.includes('novelight_');
  };

  function codePointLength(value) {
    return Array.from(String(value ?? '')).length;
  }

  function captureSelection(root) {
    const selection = window.getSelection?.();
    if (!root || !selection || selection.rangeCount < 1 || selection.isCollapsed) {
      return { ok: false, message: '本文中の誤字と思う箇所を選択してから押してください。' };
    }

    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      return { ok: false, message: '本文中の誤字と思う箇所を選択してください。' };
    }

    const originalText = range.toString();
    const sourceLength = codePointLength(originalText);
    if (sourceLength < 1 || sourceLength > 500) {
      return { ok: false, message: '選択範囲は1〜500文字にしてください。' };
    }

    const prefix = range.cloneRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(range.startContainer, range.startOffset);
    const sourceStart = codePointLength(prefix.toString()) + 1;

    return { ok: true, sourceStart, sourceLength, originalText };
  }

  function text(tag, value, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = value;
    return el;
  }

  async function mountAuthor({ client, episodeId, contentInput, root }) {
    if (!client || !episodeId || !contentInput || !root) return { ready: false };

    const status = root.querySelector('[data-typo-status]');
    const list = root.querySelector('[data-typo-list]');
    if (!status || !list) return { ready: false };

    async function load() {
      status.textContent = '誤字報告を確認しています...';
      list.replaceChildren();

      const result = await client.rpc('novelight_list_episode_typo_reports', {
        p_episode_id: Number(episodeId)
      });

      if (result.error) {
        if (missingRpc(result.error)) {
          root.hidden = true;
          return;
        }
        console.error('typo report list failed', result.error);
        status.textContent = '誤字報告を読み込めませんでした。';
        return;
      }

      root.hidden = false;
      const rows = Array.isArray(result.data) ? result.data : [];
      if (!rows.length) {
        status.textContent = '未処理の誤字報告はありません。';
        return;
      }

      status.textContent = `未処理 ${rows.length}件`;
      rows.forEach(row => {
        const card = document.createElement('article');
        card.className = 'typo-report-card';

        const meta = text(
          'div',
          new Date(row.created_at).toLocaleString('ja-JP'),
          'typo-report-meta'
        );
        const beforeLabel = text('div', '現在の提案元', 'typo-report-label');
        const before = text('pre', row.original_text ?? '', 'typo-report-before');
        const afterLabel = text('div', '修正案', 'typo-report-label');
        const after = text('pre', row.replacement_text ?? '', 'typo-report-after');
        const state = text(
          'div',
          row.is_current === true
            ? '現在の本文と一致しています。'
            : '本文が変更されているため、この提案は安全に適用できません。',
          row.is_current === true ? 'typo-report-current' : 'typo-report-stale'
        );

        const actions = document.createElement('div');
        actions.className = 'typo-report-actions';

        const apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'typo-report-apply';
        apply.textContent = '採用して本文に反映';
        apply.disabled = row.is_current !== true;

        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'typo-report-reject';
        reject.textContent = row.is_current === true ? '却下' : '閉じる';

        apply.addEventListener('click', async () => {
          if (apply.disabled) return;
          if (!window.confirm('この修正案を本文へ反映しますか？反映前の本文は改稿履歴へ保存されます。')) return;
          apply.disabled = true;
          reject.disabled = true;
          status.textContent = '修正案を反映しています...';
          try {
            const applied = await client.rpc('novelight_apply_episode_typo_report', {
              p_report_id: row.report_id
            });
            if (applied.error) throw applied.error;
            if (applied.data?.status === 'applied') {
              contentInput.value = applied.data.content ?? contentInput.value;
              contentInput.dispatchEvent(new Event('input', { bubbles: true }));
              status.textContent = '修正案を本文へ反映しました。';
            } else {
              status.textContent = '本文が更新されていたため、この提案は適用されませんでした。';
            }
            await load();
          } catch (error) {
            console.error('typo report apply failed', error);
            status.textContent = '修正案を反映できませんでした。';
            apply.disabled = false;
            reject.disabled = false;
          }
        });

        reject.addEventListener('click', async () => {
          reject.disabled = true;
          apply.disabled = true;
          status.textContent = '誤字報告を閉じています...';
          try {
            const rejected = await client.rpc('novelight_reject_episode_typo_report', {
              p_report_id: row.report_id
            });
            if (rejected.error) {
              if (row.is_current !== true && String(rejected.error?.message || '').includes('Pending typo report')) {
                await load();
                return;
              }
              throw rejected.error;
            }
            await load();
          } catch (error) {
            console.error('typo report reject failed', error);
            status.textContent = '誤字報告を閉じられませんでした。';
            reject.disabled = false;
            apply.disabled = row.is_current !== true;
          }
        });

        actions.append(apply, reject);
        card.append(meta, beforeLabel, before, afterLabel, after, state, actions);
        list.appendChild(card);
      });
    }

    await load();
    return { ready: !root.hidden, reload: load };
  }

  window.NovelightTypoReports = Object.freeze({
    captureSelection,
    mountAuthor
  });
})();
