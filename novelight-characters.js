(() => {
  const MISSING_CODES = new Set(['42883', 'PGRST202']);

  function isRuntimeMissing(error) {
    const message = String(error?.message || '');
    return MISSING_CODES.has(error?.code)
      || message.includes('Could not find the function')
      || message.includes('does not exist');
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  async function mountReader({ client, episodeId }) {
    const body = document.querySelector('.content');
    const meta = document.querySelector('.meta');
    if (!body || !meta || !episodeId) return;

    let mount = document.getElementById('characterReaderMount');
    if (!mount) {
      mount = document.createElement('section');
      mount.id = 'characterReaderMount';
      mount.className = 'novelight-character-reader';
      mount.hidden = true;
      meta.before(mount);
    }

    try {
      const result = await client.rpc('novelight_character_feed', {
        p_episode_id: String(episodeId)
      });
      if (result.error) {
        if (isRuntimeMissing(result.error)) return;
        throw result.error;
      }

      const rows = Array.isArray(result.data) ? result.data : [];
      if (!rows.length) {
        mount.hidden = true;
        mount.replaceChildren();
        return;
      }

      mount.hidden = false;
      mount.innerHTML = `
        <div class="novelight-character-reader-head">
          <div>
            <div class="novelight-character-kicker">CHARACTERS</div>
            <h2>この話までの登場人物</h2>
          </div>
          <p>この話より先の登場情報は表示しません。</p>
        </div>
        <div class="novelight-character-reader-list">
          ${rows.map((row) => {
            const latest = row.appears_current_episode
              ? 'この話に登場'
              : `最終登場：第${Number(row.latest_episode_number)}話${row.latest_episode_title ? `「${escapeHtml(row.latest_episode_title)}」` : ''}`;
            return `
              <article class="novelight-character-reader-item">
                <strong>${escapeHtml(row.name)}</strong>
                <span>${latest}</span>
              </article>
            `;
          }).join('')}
        </div>
      `;
    } catch (error) {
      console.error('character reader feed unavailable', error);
      mount.hidden = true;
    }
  }

  async function mountEpisodeEditor({ client, episodeId, novelId }) {
    const form = document.getElementById('form');
    const buttons = form?.querySelector('.buttons');
    if (!form || !buttons || !episodeId) return;

    let mount = document.getElementById('characterEpisodeEditor');
    if (!mount) {
      mount = document.createElement('section');
      mount.id = 'characterEpisodeEditor';
      mount.className = 'novelight-character-editor';
      buttons.before(mount);
    }

    async function load() {
      mount.innerHTML = '<p class="novelight-character-status">登場人物の出現状態を確認しています...</p>';
      try {
        const result = await client.rpc('novelight_episode_character_editor', {
          p_episode_id: String(episodeId)
        });
        if (result.error) {
          if (isRuntimeMissing(result.error)) {
            mount.innerHTML = '<p class="novelight-character-status">登場人物機能はデータベース反映待ちです。</p>';
            return;
          }
          throw result.error;
        }

        const rows = Array.isArray(result.data) ? result.data : [];
        if (!rows.length) {
          mount.innerHTML = `
            <div class="novelight-character-editor-head">
              <div><div class="novelight-character-kicker">CHARACTERS</div><h2>この話の登場人物</h2></div>
              <a href="characters.html?novel_id=${encodeURIComponent(novelId || '')}">登場人物を登録 →</a>
            </div>
            <p class="novelight-character-status">まだ登場人物が登録されていません。</p>
          `;
          return;
        }

        mount.innerHTML = `
          <div class="novelight-character-editor-head">
            <div><div class="novelight-character-kicker">CHARACTERS</div><h2>この話の登場人物</h2></div>
            <a href="characters.html?novel_id=${encodeURIComponent(novelId || '')}">人物管理 →</a>
          </div>
          <p class="novelight-character-help">本文から自動判定します。必要なときだけ手動指定が優先されます。</p>
          <div class="novelight-character-editor-list">
            ${rows.map((row) => `
              <label class="novelight-character-editor-row">
                <span>
                  <strong>${escapeHtml(row.name)}</strong>
                  <small>${row.auto_detected ? '本文で自動検出' : '本文では未検出'}${row.effective ? '・この話に表示対象' : ''}</small>
                </span>
                <select data-character-override="${row.id}">
                  <option value="auto" ${row.override_mode === 'auto' ? 'selected' : ''}>自動</option>
                  <option value="include" ${row.override_mode === 'include' ? 'selected' : ''}>この話に含める</option>
                  <option value="exclude" ${row.override_mode === 'exclude' ? 'selected' : ''}>この話から除外</option>
                </select>
              </label>
            `).join('')}
          </div>
          <div class="novelight-character-status" aria-live="polite"></div>
        `;

        mount.querySelectorAll('[data-character-override]').forEach((select) => {
          select.addEventListener('change', async () => {
            const status = mount.querySelector('.novelight-character-status');
            select.disabled = true;
            status.textContent = '保存しています...';
            try {
              const result = await client.rpc('novelight_set_character_episode_override', {
                p_character_id: select.dataset.characterOverride,
                p_episode_id: String(episodeId),
                p_override_mode: select.value
              });
              if (result.error) throw result.error;
              await load();
            } catch (error) {
              console.error(error);
              status.textContent = '登場人物の指定を保存できませんでした。';
              select.disabled = false;
            }
          });
        });
      } catch (error) {
        console.error('character episode editor unavailable', error);
        mount.innerHTML = '<p class="novelight-character-status">登場人物の状態を読み込めませんでした。</p>';
      }
    }

    await load();
  }

  window.NovelightCharacters = {
    isRuntimeMissing,
    mountReader,
    mountEpisodeEditor
  };
})();
