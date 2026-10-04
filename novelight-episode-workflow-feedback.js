(function attachEpisodeWorkflowFeedback(global) {
  'use strict';

  if (global.__novelightEpisodeWorkflowFeedbackLoaded) return;
  global.__novelightEpisodeWorkflowFeedbackLoaded = true;

  const SUPABASE_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const page = (global.location.pathname.split('/').pop() || '').toLowerCase();
  const isPostPage = page === 'episode-post.html' || page === 'episode-post';
  const isEditPage = page === 'episode-edit.html' || page === 'episode-edit';
  if (!isPostPage && !isEditPage) return;

  const api = global.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  if (!api) return;

  let novelId = new URLSearchParams(global.location.search).get('novel_id');
  let episodeId = isEditPage ? new URLSearchParams(global.location.search).get('id') : null;
  let episodeStatus = isPostPage ? 'draft' : null;
  let numberVisibilitySupported = true;
  let saveObserver = null;

  function missingColumn(error) {
    const message = String(error?.message || '');
    return error?.code === '42703'
      || error?.code === 'PGRST204'
      || message.includes('show_episode_number')
      || message.includes('does not exist');
  }

  function installStyles() {
    if (document.getElementById('novelight-episode-workflow-feedback-style')) return;
    const style = document.createElement('style');
    style.id = 'novelight-episode-workflow-feedback-style';
    style.textContent = `
      .novelight-draft-list-direct{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
      .novelight-episode-number-setting{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:-7px 0 14px;padding:11px 14px;border:1px solid #e4ded2;border-radius:10px;background:#fffdf8;color:#514537}
      .novelight-episode-number-copy{min-width:0}.novelight-episode-number-copy strong{display:block;font-size:13px}.novelight-episode-number-copy small{display:block;margin-top:3px;color:#7a7065;font-size:11px;line-height:1.5}
      .novelight-episode-number-toggle{display:inline-flex;align-items:center;gap:8px;white-space:nowrap;font-size:12px;font-weight:900}.novelight-episode-number-toggle input{width:18px;height:18px;accent-color:#6d4aff}
      .novelight-episode-number-setting.is-saving{opacity:.68}
      @media(max-width:720px){.novelight-episode-number-setting{align-items:flex-start;flex-direction:column}.novelight-episode-number-toggle{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function currentDraftIdFromUrl() {
    const value = Number(new URLSearchParams(global.location.search).get('draft_id'));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  async function resolveContext() {
    if (isEditPage && episodeId) {
      let result = await api
        .from('episodes')
        .select('id,novel_id,status,show_episode_number')
        .eq('id', episodeId)
        .maybeSingle();
      if (result.error && missingColumn(result.error)) {
        numberVisibilitySupported = false;
        result = await api
          .from('episodes')
          .select('id,novel_id,status')
          .eq('id', episodeId)
          .maybeSingle();
      }
      if (result.error) throw result.error;
      novelId = result.data?.novel_id ? String(result.data.novel_id) : novelId;
      episodeStatus = result.data?.status || null;
      return result.data || null;
    }

    const draftId = currentDraftIdFromUrl();
    if (!draftId) return null;
    let result = await api
      .from('episodes')
      .select('id,novel_id,status,show_episode_number')
      .eq('id', draftId)
      .maybeSingle();
    if (result.error && missingColumn(result.error)) {
      numberVisibilitySupported = false;
      result = await api
        .from('episodes')
        .select('id,novel_id,status')
        .eq('id', draftId)
        .maybeSingle();
    }
    if (result.error) throw result.error;
    novelId = result.data?.novel_id ? String(result.data.novel_id) : novelId;
    episodeId = result.data?.id ? String(result.data.id) : episodeId;
    episodeStatus = result.data?.status || 'draft';
    return result.data || null;
  }

  function installAutosaveClarity() {
    const state = document.getElementById('saveState');
    if (!state) return;

    function rewrite() {
      if (episodeStatus && episodeStatus !== 'draft') return;
      const value = String(state.textContent || '').trim();
      if (value === '自動保存') {
        state.textContent = '入力内容は下書きに自動保存されます';
        return;
      }
      if (value === '保存済み') {
        const now = new Date();
        state.textContent = `下書きに自動保存済み ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      }
    }

    rewrite();
    saveObserver?.disconnect();
    saveObserver = new MutationObserver(rewrite);
    saveObserver.observe(state, { childList: true, characterData: true, subtree: true });
  }

  function installDraftListLink() {
    const tools = document.querySelector('.editor-tools');
    if (!tools || tools.querySelector('[data-direct-draft-list]') || !novelId) return;
    const link = document.createElement('a');
    link.className = 'tool-button novelight-draft-list-direct';
    link.dataset.directDraftList = 'true';
    link.href = `episode-drafts.html?novel_id=${encodeURIComponent(novelId)}`;
    link.textContent = '下書き一覧';
    link.addEventListener('click', async (event) => {
      if (!isPostPage) return;
      event.preventDefault();
      const destination = link.href;
      try {
        if (typeof waitForAutoSave === 'function') await waitForAutoSave();
      } catch (error) {
        console.warn('autosave before draft-list navigation failed', error);
      }
      global.location.href = destination;
    });
    const publishButton = document.getElementById('publish');
    tools.insertBefore(link, publishButton || null);
  }

  function installImmediatePublish(initialRow) {
    const draft = (initialRow?.status || episodeStatus) === 'draft';
    if (!draft) return;

    const primary = document.getElementById(isPostPage ? 'publish' : 'save');
    if (primary) primary.textContent = '今すぐ公開';

    if (!isEditPage) return;
    const actions = document.querySelector('#schedulePane .drawer-actions');
    if (!actions || actions.querySelector('[data-publish-now-from-schedule]')) return;
    const publishNow = document.createElement('button');
    publishNow.type = 'button';
    publishNow.className = 'drawer-action';
    publishNow.dataset.publishNowFromSchedule = 'true';
    publishNow.textContent = '今すぐ公開';
    publishNow.addEventListener('click', () => {
      document.getElementById('closeDrawer')?.click();
      const currentPrimary = document.getElementById('save');
      if (currentPrimary && !currentPrimary.disabled) currentPrimary.click();
    });
    actions.prepend(publishNow);
  }

  async function ensurePostDraft() {
    const fromUrl = currentDraftIdFromUrl();
    if (fromUrl) return fromUrl;
    if (typeof waitForAutoSave === 'function') await waitForAutoSave();
    const afterWait = currentDraftIdFromUrl();
    if (afterWait) return afterWait;
    if (typeof persistDraft === 'function' && typeof authorValues === 'function') {
      const id = Number(await persistDraft(authorValues()));
      if (Number.isSafeInteger(id) && id > 0) return id;
    }
    throw new Error('下書きを作成できませんでした。本文を一度入力してから再度お試しください。');
  }

  async function currentEntry() {
    const id = isPostPage ? (currentDraftIdFromUrl() || episodeId) : episodeId;
    if (!id) return null;
    const result = await api
      .from('episodes')
      .select('id,novel_id,status,show_episode_number')
      .eq('id', id)
      .maybeSingle();
    if (result.error) {
      if (missingColumn(result.error)) {
        numberVisibilitySupported = false;
        return null;
      }
      throw result.error;
    }
    return result.data || null;
  }

  async function installNumberToggle(initialRow) {
    if (!numberVisibilitySupported) return;
    const surface = document.querySelector('.writing-surface');
    if (!surface || document.getElementById('novelightEpisodeNumberSetting')) return;

    let row = initialRow;
    if (!row && (episodeId || currentDraftIdFromUrl())) row = await currentEntry();

    const panel = document.createElement('section');
    panel.id = 'novelightEpisodeNumberSetting';
    panel.className = 'novelight-episode-number-setting';
    panel.innerHTML = `
      <div class="novelight-episode-number-copy">
        <strong>自動の「第○話」表示</strong>
        <small>幕間・人物紹介・設定資料など、話数を付けたくないエピソードだけオフにできます。並び順はそのまま保持されます。</small>
      </div>
      <label class="novelight-episode-number-toggle"><input type="checkbox" checked>表示する</label>
    `;
    const checkbox = panel.querySelector('input');
    checkbox.checked = row?.show_episode_number !== false;
    surface.before(panel);

    checkbox.addEventListener('change', async () => {
      const desired = checkbox.checked;
      checkbox.disabled = true;
      panel.classList.add('is-saving');
      try {
        let targetId = isEditPage ? Number(episodeId) : currentDraftIdFromUrl();
        if (!targetId && isPostPage) targetId = await ensurePostDraft();
        if (!Number.isSafeInteger(Number(targetId)) || Number(targetId) < 1) {
          throw new Error('エピソードを特定できませんでした。');
        }
        const result = await api
          .from('episodes')
          .update({ show_episode_number: desired })
          .eq('id', Number(targetId));
        if (result.error) throw result.error;
        episodeId = String(targetId);
        episodeStatus = episodeStatus || 'draft';
      } catch (error) {
        checkbox.checked = !desired;
        if (missingColumn(error)) {
          numberVisibilitySupported = false;
          panel.remove();
          console.warn('per-episode number visibility is awaiting database migration', error);
        } else {
          console.error('episode number preference save failed', error);
          global.alert('話数表示の設定を保存できませんでした。時間をおいてもう一度お試しください。');
        }
      } finally {
        checkbox.disabled = false;
        panel.classList.remove('is-saving');
      }
    });
  }

  async function start() {
    installStyles();
    let initialRow = null;
    try {
      initialRow = await resolveContext();
    } catch (error) {
      console.warn('episode workflow context unavailable', error);
    }
    installAutosaveClarity();
    installDraftListLink();
    installImmediatePublish(initialRow);
    try {
      await installNumberToggle(initialRow);
    } catch (error) {
      console.warn('episode number toggle unavailable', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void start(), { once: true });
  } else {
    void start();
  }
})(typeof window === 'undefined' ? globalThis : window);