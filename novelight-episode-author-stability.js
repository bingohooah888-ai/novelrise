(() => {
  'use strict';

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

  function currentDraftId() {
    const value = Number(new URL(location.href).searchParams.get('draft_id'));
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function setDraftContext(draftId, episodeNumber = null) {
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

  function clearDraftContext() {
    const url = new URL(location.href);
    if (!url.searchParams.has('draft_id')) return;
    url.searchParams.delete('draft_id');
    history.replaceState(history.state, '', url);
    delete document.documentElement.dataset.novelightEpisodePostDraftNumber;
  }

  function lockedEpisodeNumber() {
    const stored = Number(document.documentElement.dataset.novelightEpisodePostDraftNumber);
    if (Number.isInteger(stored) && stored > 0) return stored;
    const value = Number(document.getElementById('episodeNumber')?.value);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function chapterId() {
    const value = Number(document.getElementById('chapterId')?.value);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function formValues() {
    return {
      episodeNumber: lockedEpisodeNumber(),
      title: document.getElementById('title')?.value.trim() || '',
      content: document.getElementById('content')?.value || '',
      chapterId: chapterId()
    };
  }

  function installRpcGuard(api, novelId) {
    if (!api || api.__novelightEpisodePostRpcGuard === true) return;
    api.__novelightEpisodePostRpcGuard = true;
    const originalRpc = api.rpc.bind(api);

    api.rpc = async (name, args, options) => {
      const draftId = currentDraftId();

      if (name === 'novelight_save_episode_draft') {
        const nextArgs = { ...(args || {}) };
        const lockedNumber = lockedEpisodeNumber();
        if (draftId && !Number(nextArgs.p_episode_id)) nextArgs.p_episode_id = draftId;
        if (draftId && lockedNumber) nextArgs.p_episode_number = lockedNumber;
        const result = await originalRpc(name, nextArgs, options);
        if (!result.error) {
          const savedId = Number(result.data);
          if (Number.isInteger(savedId) && savedId > 0) {
            setDraftContext(savedId, Number(nextArgs.p_episode_number));
          }
        }
        return result;
      }

      if (name === 'novelight_publish_episode_atomic' && draftId) {
        const values = formValues();
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

  async function restoreDraft(api, novelId) {
    const draftId = currentDraftId();
    if (!draftId) return false;
    const result = await api.from('episodes')
      .select('id,episode_number,title,content,chapter_id,status')
      .eq('id', draftId)
      .eq('novel_id', novelId)
      .limit(1);
    if (result.error) throw result.error;
    const draft = Array.isArray(result.data) ? result.data[0] : null;
    if (!draft || draft.status !== 'draft') {
      clearDraftContext();
      return false;
    }

    const episodeNumber = Number(draft.episode_number);
    setDraftContext(draft.id, episodeNumber);
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

  async function inheritPreviousChapter(api, novelId) {
    if (currentDraftId()) return;
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

  function updateChapterHelp() {
    const note = document.querySelector('#chapterPane .drawer-note');
    if (note) note.textContent = '新しい話は直前の話の章を初期値として引き継ぎます。必要ならここで変更できます。章の追加や話の並び替えは管理画面で行えます。';
  }

  function installStructureSafeNavigation(api, novelId) {
    const link = document.getElementById('manageStructureLink');
    if (!link || link.dataset.novelightDraftSafeNavigation === 'true') return;
    link.dataset.novelightDraftSafeNavigation = 'true';
    link.addEventListener('click', async (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = link.href;
      const values = formValues();
      const shouldSave = Boolean(currentDraftId() || values.title || values.content.trim() || values.chapterId);
      if (!shouldSave) {
        location.href = target;
        return;
      }
      const status = document.getElementById('status');
      if (status) status.textContent = '下書きを保存しています...';
      try {
        const result = await api.rpc('novelight_save_episode_draft', {
          p_novel_id: novelId,
          p_episode_id: currentDraftId(),
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
        setDraftContext(draftId, values.episodeNumber);
        location.href = target;
      } catch (error) {
        console.error('episode structure navigation draft save failed', error);
        if (status) status.textContent = '下書きを保存できませんでした。保存してからもう一度お試しください。';
      }
    }, true);
  }

  function waitForPostReady(api, novelId, attempt = 0) {
    const number = document.getElementById('episodeNumber');
    const chapter = document.getElementById('chapterId');
    const structure = document.getElementById('manageStructureLink');
    const ready = Boolean(number?.value && chapter?.options?.length && structure?.getAttribute('href') && structure.getAttribute('href') !== '#');
    if (!ready) {
      if (attempt < 100) window.setTimeout(() => waitForPostReady(api, novelId, attempt + 1), 50);
      return;
    }
    installStructureSafeNavigation(api, novelId);
    updateChapterHelp();
    void (async () => {
      try {
        const restored = await restoreDraft(api, novelId);
        if (!restored) await inheritPreviousChapter(api, novelId);
      } catch (error) {
        console.error('episode post stability initialization failed', error);
      }
    })();
  }

  function installPostStability(attempt = 0) {
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
      if (attempt < 100) window.setTimeout(() => installPostStability(attempt + 1), 20);
      return;
    }
    installRpcGuard(api, novelId);
    waitForPostReady(api, novelId);
  }

  window.setTimeout(installCharacterToolbarNormalization, 0);
  window.setTimeout(() => installPostStability(), 0);
})();