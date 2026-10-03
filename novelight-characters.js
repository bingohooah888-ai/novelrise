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

  function ensureEditorStyles() {
    if (document.getElementById('novelightCharacterEpisodeStateStyles')) return;
    const style = document.createElement('style');
    style.id = 'novelightCharacterEpisodeStateStyles';
    style.textContent = `
      .novelight-character-editor-row{border-left:3px solid transparent;transition:background-color .15s ease,border-color .15s ease}
      .novelight-character-editor-row.is-effective{background:rgba(109,74,255,.07);border-left-color:#8a73dd}
      .novelight-character-editor-row.is-inactive{background:#fafafa;border-left-color:#dedede}
      .novelight-character-effective-label{display:inline-flex;align-items:center;margin-right:5px;padding:2px 6px;border-radius:999px;font-size:10px;font-weight:900;letter-spacing:.02em}
      .novelight-character-editor-row.is-effective .novelight-character-effective-label{background:#eee9ff;color:#5740aa}
      .novelight-character-editor-row.is-inactive .novelight-character-effective-label{background:#eeeeef;color:#68686d}
    `;
    document.head.appendChild(style);
  }

  function overrideLabel(mode) {
    if (mode === 'include') return '手動で含める';
    if (mode === 'exclude') return '手動で除外';
    return '自動';
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

  async function mountEpisodeEditor({ client, episodeId, novelId, mountTarget = null }) {
    if (!episodeId) return;
    ensureEditorStyles();

    let mount;
    if (mountTarget) {
      mount = mountTarget.querySelector('[data-novelight-character-episode-editor]');
      if (!mount) {
        mount = document.createElement('section');
        mount.dataset.novelightCharacterEpisodeEditor = 'true';
        mount.className = 'novelight-character-editor';
        mountTarget.replaceChildren(mount);
      }
    } else {
      const form = document.getElementById('form');
      const buttons = form?.querySelector('.buttons');
      if (!form || !buttons) return;
      mount = document.getElementById('characterEpisodeEditor');
      if (!mount) {
        mount = document.createElement('section');
        mount.id = 'characterEpisodeEditor';
        mount.className = 'novelight-character-editor';
        buttons.before(mount);
      }
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
              <label class="novelight-character-editor-row ${row.effective ? 'is-effective' : 'is-inactive'}">
                <span>
                  <strong>${escapeHtml(row.name)}</strong>
                  <small><span class="novelight-character-effective-label">${row.effective ? '反映中' : '未反映'}</span>${row.auto_detected ? '本文で自動検出' : '本文では未検出'}・${overrideLabel(row.override_mode)}</small>
                </span>
                <select data-character-override="${row.id}" aria-label="${escapeHtml(row.name)}の反映方法">
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

  function normalizeEpisodeCharacterToolbar() {
    const toolbar = document.querySelector('.editor-tools');
    if (!toolbar) return;
    const integrated = document.getElementById('openCharacterSettings');
    toolbar.querySelectorAll('button.tool-button').forEach((button) => {
      const label = button.textContent.trim();
      if (button === integrated) {
        button.textContent = '登場人物';
        return;
      }
      if (label !== '人物') return;
      if (integrated) button.remove();
      else button.textContent = '登場人物';
    });
  }

  function installCharacterToolbarNormalization() {
    if (!document.body.classList.contains('novelight-page-episode-post')
      && !document.body.classList.contains('novelight-page-episode-edit')) return;
    const toolbar = document.querySelector('.editor-tools');
    if (!toolbar) return;
    normalizeEpisodeCharacterToolbar();
    const observer = new MutationObserver(normalizeEpisodeCharacterToolbar);
    observer.observe(toolbar, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 4000);
  }

  function currentEpisodePostDraftId() {
    const value = Number(new URL(location.href).searchParams.get('draft_id'));
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function setEpisodePostDraftContext(draftId, episodeNumber = null) {
    const id = Number(draftId);
    if (!Number.isInteger(id) || id <= 0) return;
    const url = new URL(location.href);
    url.searchParams.set('draft_id', String(id));
    history.replaceState(history.state, '', url);
    const number = Number(episodeNumber);
    if (Number.isInteger(number) && number > 0) {
      document.documentElement.dataset.novelightEpisodePostDraftNumber = String(number);
    }
  }

  function clearEpisodePostDraftContext() {
    const url = new URL(location.href);
    if (!url.searchParams.has('draft_id')) return;
    url.searchParams.delete('draft_id');
    history.replaceState(history.state, '', url);
    delete document.documentElement.dataset.novelightEpisodePostDraftNumber;
  }

  function lockedEpisodePostNumber() {
    const stored = Number(document.documentElement.dataset.novelightEpisodePostDraftNumber);
    if (Number.isInteger(stored) && stored > 0) return stored;
    const input = document.getElementById('episodeNumber');
    const value = Number(input?.value);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function episodePostChapterId() {
    const value = Number(document.getElementById('chapterId')?.value);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function episodePostFormValues() {
    return {
      episodeNumber: lockedEpisodePostNumber(),
      title: document.getElementById('title')?.value.trim() || '',
      content: document.getElementById('content')?.value || '',
      chapterId: episodePostChapterId()
    };
  }

  function installEpisodePostRpcGuard(api, novelId) {
    if (!api || api.__novelightEpisodePostRpcGuard === true) return;
    api.__novelightEpisodePostRpcGuard = true;
    const originalRpc = api.rpc.bind(api);

    api.rpc = async (name, args, options) => {
      const draftId = currentEpisodePostDraftId();

      if (name === 'novelight_save_episode_draft') {
        const nextArgs = { ...(args || {}) };
        const lockedNumber = lockedEpisodePostNumber();
        if (draftId && !Number(nextArgs.p_episode_id)) nextArgs.p_episode_id = draftId;
        if (draftId && lockedNumber) nextArgs.p_episode_number = lockedNumber;
        const result = await originalRpc(name, nextArgs, options);
        if (!result.error) {
          const savedId = Number(result.data);
          if (Number.isInteger(savedId) && savedId > 0) {
            setEpisodePostDraftContext(savedId, Number(nextArgs.p_episode_number));
          }
        }
        return result;
      }

      if (name === 'novelight_publish_episode_atomic' && draftId) {
        const values = episodePostFormValues();
        const saveResult = await originalRpc('novelight_save_episode_draft', {
          p_novel_id: novelId,
          p_episode_id: draftId,
          p_episode_number: values.episodeNumber,
          p_title: values.title,
          p_content: values.content
        });
        if (saveResult.error) return saveResult;
        const chapterResult = await api.from('episodes')
          .update({ chapter_id: values.chapterId })
          .eq('id', draftId)
          .eq('novel_id', novelId);
        if (chapterResult.error) return chapterResult;
        const publishResult = await originalRpc('novelight_publish_episode_draft_atomic', {
          p_episode_id: draftId
        });
        return publishResult.error ? publishResult : { ...publishResult, data: draftId };
      }

      return originalRpc(name, args, options);
    };
  }

  async function restoreEpisodePostDraft(api, novelId) {
    const draftId = currentEpisodePostDraftId();
    if (!draftId) return false;
    const result = await api.from('episodes')
      .select('id,episode_number,title,content,chapter_id,status')
      .eq('id', draftId)
      .eq('novel_id', novelId)
      .limit(1);
    if (result.error) throw result.error;
    const draft = Array.isArray(result.data) ? result.data[0] : null;
    if (!draft || draft.status !== 'draft') {
      clearEpisodePostDraftContext();
      return false;
    }

    const episodeNumber = Number(draft.episode_number);
    setEpisodePostDraftContext(draft.id, episodeNumber);
    const numberInput = document.getElementById('episodeNumber');
    const heading = document.getElementById('episodeHeading');
    const title = document.getElementById('title');
    const content = document.getElementById('content');
    const chapter = document.getElementById('chapterId');
    if (numberInput) numberInput.value = String(episodeNumber);
    if (heading) heading.textContent = `第${episodeNumber}話`;
    if (title) title.value = draft.title || '';
    if (content) {
      content.value = draft.content || '';
      content.style.setProperty('height', 'auto', 'important');
      content.style.setProperty('height', `${Math.max(content.scrollHeight, window.matchMedia('(max-width:720px)').matches ? 480 : 560)}px`, 'important');
    }
    if (chapter) chapter.value = draft.chapter_id == null ? '' : String(draft.chapter_id);
    const saveState = document.getElementById('saveState');
    if (saveState) saveState.textContent = '保存済み';
    numberInput?.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  async function inheritEpisodePostChapter(api, novelId) {
    if (currentEpisodePostDraftId()) return;
    const chapter = document.getElementById('chapterId');
    const numberInput = document.getElementById('episodeNumber');
    if (!chapter || !numberInput) return;
    const result = await api.from('episodes')
      .select('episode_number,chapter_id')
      .eq('novel_id', novelId)
      .order('episode_number', { ascending: false })
      .limit(1);
    if (result.error) throw result.error;
    const latest = Array.isArray(result.data) ? result.data[0] : null;
    if (!latest || latest.chapter_id == null) return;
    const expected = Number(latest.episode_number) + 1;
    if (Number(numberInput.value) !== expected) return;
    const value = String(latest.chapter_id);
    if ([...chapter.options].some((option) => option.value === value)) chapter.value = value;
  }

  function updateEpisodePostChapterHelp() {
    const note = document.querySelector('#chapterPane .drawer-note');
    if (note) note.textContent = '新しい話は直前の話の章を初期値として引き継ぎます。必要ならここで変更できます。章の追加や話の並び替えは管理画面で行えます。';
  }

  function installEpisodePostStructureSave(api, novelId) {
    const link = document.getElementById('manageStructureLink');
    if (!link || link.dataset.novelightDraftSafeNavigation === 'true') return;
    link.dataset.novelightDraftSafeNavigation = 'true';
    link.addEventListener('click', async (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = link.href;
      const values = episodePostFormValues();
      const shouldSave = Boolean(currentEpisodePostDraftId() || values.title || values.content.trim() || values.chapterId);
      if (!shouldSave) {
        location.href = target;
        return;
      }
      const status = document.getElementById('status');
      if (status) status.textContent = '下書きを保存しています...';
      try {
        const result = await api.rpc('novelight_save_episode_draft', {
          p_novel_id: novelId,
          p_episode_id: currentEpisodePostDraftId(),
          p_episode_number: values.episodeNumber,
          p_title: values.title,
          p_content: values.content
        });
        if (result.error) throw result.error;
        const draftId = Number(result.data);
        if (!Number.isInteger(draftId) || draftId <= 0) throw new Error('draft id unavailable');
        const chapterResult = await api.from('episodes')
          .update({ chapter_id: values.chapterId })
          .eq('id', draftId)
          .eq('novel_id', novelId);
        if (chapterResult.error) throw chapterResult.error;
        setEpisodePostDraftContext(draftId, values.episodeNumber);
        location.href = target;
      } catch (error) {
        console.error('episode structure navigation draft save failed', error);
        if (status) status.textContent = '下書きを保存できませんでした。保存してからもう一度お試しください。';
      }
    }, true);
  }

  function waitForEpisodePostReady(api, novelId, attempt = 0) {
    const number = document.getElementById('episodeNumber');
    const chapter = document.getElementById('chapterId');
    const structure = document.getElementById('manageStructureLink');
    const ready = Boolean(number?.value && chapter?.options?.length && structure?.getAttribute('href') && structure.getAttribute('href') !== '#');
    if (!ready) {
      if (attempt < 100) window.setTimeout(() => waitForEpisodePostReady(api, novelId, attempt + 1), 50);
      return;
    }
    installEpisodePostStructureSave(api, novelId);
    updateEpisodePostChapterHelp();
    void (async () => {
      try {
        const restored = await restoreEpisodePostDraft(api, novelId);
        if (!restored) await inheritEpisodePostChapter(api, novelId);
      } catch (error) {
        console.error('episode post stability initialization failed', error);
      }
    })();
  }

  function installEpisodePostStability(attempt = 0) {
    if (!document.body.classList.contains('novelight-page-episode-post')) return;
    const novelId = new URLSearchParams(location.search).get('novel_id');
    if (!novelId) return;
    let api = null;
    try {
      if (typeof client !== 'undefined') api = client;
    } catch {
      api = null;
    }
    if (!api) {
      if (attempt < 100) window.setTimeout(() => installEpisodePostStability(attempt + 1), 20);
      return;
    }
    installEpisodePostRpcGuard(api, novelId);
    waitForEpisodePostReady(api, novelId);
  }

  window.setTimeout(installCharacterToolbarNormalization, 0);
  window.setTimeout(() => installEpisodePostStability(), 0);

  window.NovelightCharacters = {
    isRuntimeMissing,
    mountReader,
    mountEpisodeEditor
  };
})();