(function () {
  'use strict';

  const SUPABASE_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const SUPABASE_PROJECT_REF = 'fiepaguycecrredwrcwx';
  const OWNER_RECOVERY_ATTEMPTS = 6;
  const OWNER_RECOVERY_RETRY_MS = 750;

  function esc(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  function mountAuthorNotesLink() {
    const author = document.querySelector('#novelHeader .author');
    const profileLink = author?.querySelector('a[href^="author.html?id="]');
    if (!author || !profileLink || author.querySelector('[data-author-notes-link]')) return;
    const notesLink = document.createElement('a');
    notesLink.href = `${profileLink.getAttribute('href')}#author-notes`;
    notesLink.textContent = '近況ノート';
    notesLink.dataset.authorNotesLink = 'true';
    author.append(document.createTextNode(' ・ '), notesLink);
  }

  const novelHeader = document.getElementById('novelHeader');
  if (novelHeader) {
    new MutationObserver(mountAuthorNotesLink).observe(novelHeader, {
      childList: true,
      subtree: true
    });
    mountAuthorNotesLink();
  }

  function ensureStyles() {
    if (document.getElementById('novelight-series-styles')) return;
    const style = document.createElement('style');
    style.id = 'novelight-series-styles';
    style.textContent =
      '.novelight-series-context{padding:24px 28px;margin-bottom:18px}' +
      '.novelight-series-context h2{font-size:20px;margin-bottom:5px}' +
      '.novelight-series-context .series-description{color:#666;line-height:1.7;margin-bottom:14px;white-space:pre-wrap}' +
      '.novelight-series-context ol{padding-left:24px;display:grid;gap:7px}' +
      '.novelight-series-context li.current{font-weight:900;color:#5b43bf}' +
      '.novelight-series-nav{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}' +
      '.novelight-series-nav a{padding:11px 13px;border:1px solid #d8d8df;border-radius:9px;background:#fff;font-size:13px;font-weight:800}' +
      '.novelight-series-nav a.next{text-align:right}' +
      'html[data-novelight-verified-owner="true"] #ownerActions,html[data-novelight-verified-owner="true"] #ownerActionsTop{display:flex!important}' +
      'html[data-novelight-verified-owner="true"] #backToMyNovels,html[data-novelight-verified-owner="true"] #backToMyNovelsTop{display:inline-block!important}' +
      'html[data-novelight-verified-owner="true"] #readerReportAction{display:none!important}' +
      '@media(max-width:640px){.novelight-series-context{padding:21px 18px}.novelight-series-nav{grid-template-columns:1fr}}';
    document.head.appendChild(style);
  }

  function makeOwnerRecoveryClient() {
    if (!globalThis.supabase?.createClient) return null;
    return globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  function readStoredAccessToken() {
    try {
      const raw = globalThis.localStorage?.getItem(
        `sb-${SUPABASE_PROJECT_REF}-auth-token`
      );
      if (!raw) return null;
      const stored = JSON.parse(raw);
      return stored?.access_token ?? stored?.currentSession?.access_token ?? null;
    } catch (error) {
      console.warn('verified owner stored session unavailable', error);
      return null;
    }
  }

  async function verifyOwnerViaRest(novelId) {
    const accessToken = readStoredAccessToken();
    if (!accessToken) throw new Error('authenticated access token unavailable');

    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    };
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers });
    if (!userResponse.ok) {
      throw new Error(`authenticated user verification failed: ${userResponse.status}`);
    }
    const user = await userResponse.json();
    if (!user?.id) throw new Error('authenticated user id unavailable');

    const url = new URL(`${SUPABASE_URL}/rest/v1/novels`);
    url.searchParams.set('select', 'id,user_id');
    url.searchParams.set('id', `eq.${novelId}`);
    url.searchParams.set('limit', '1');
    const ownershipResponse = await fetch(url, { headers });
    if (!ownershipResponse.ok) {
      throw new Error(`owner verification query failed: ${ownershipResponse.status}`);
    }
    const rows = await ownershipResponse.json();
    const ownership = Array.isArray(rows) ? rows[0] : null;
    if (!ownership || String(ownership.user_id) !== String(user.id)) return null;
    return { userId: user.id };
  }

  function configureVerifiedOwnerActions(client, novelId, userId) {
    ensureStyles();
    document.documentElement.dataset.novelightVerifiedOwner = 'true';

    const novelParam = encodeURIComponent(novelId);
    const hrefs = {
      backToMyNovels: 'my-novels.html',
      backToMyNovelsTop: 'my-novels.html',
      editNovel: `novel-edit.html?id=${novelParam}`,
      editNovelTop: `novel-edit.html?id=${novelParam}`,
      newEpisode: `episode-post.html?novel_id=${novelParam}`,
      newEpisodeTop: `episode-post.html?novel_id=${novelParam}`,
      manageStructure: `episode-structure.html?novel_id=${novelParam}`,
      manageStructureTop: `episode-structure.html?novel_id=${novelParam}`,
      manageSchedule: `episode-schedule.html?novel_id=${novelParam}`,
      manageScheduleTop: `episode-schedule.html?novel_id=${novelParam}`,
      manageTypos: `typo-reports.html?novel_id=${novelParam}`,
      manageTyposTop: `typo-reports.html?novel_id=${novelParam}`,
      manageInteractions: `interaction-settings.html?novel_id=${novelParam}`,
      manageInteractionsTop: `interaction-settings.html?novel_id=${novelParam}`,
      manageCharacters: `characters.html?novel_id=${novelParam}`,
      manageCharactersTop: `characters.html?novel_id=${novelParam}`,
      managePolls: `novel-polls.html?novel_id=${novelParam}`,
      managePollsTop: `novel-polls.html?novel_id=${novelParam}`,
      manageStoryNotes: `story-notes.html?novel_id=${novelParam}`,
      manageStoryNotesTop: `story-notes.html?novel_id=${novelParam}`,
      manageCollaboration: `collaboration.html?novel_id=${novelParam}`,
      manageCollaborationTop: `collaboration.html?novel_id=${novelParam}`
    };

    for (const [id, href] of Object.entries(hrefs)) {
      const link = document.getElementById(id);
      if (link) link.href = href;
    }

    for (const id of ['ownerActions', 'ownerActionsTop']) {
      const container = document.getElementById(id);
      if (!container) continue;
      const keepVisible = () => {
        if (container.style.display !== 'flex') container.style.display = 'flex';
      };
      keepVisible();
      if (
        typeof MutationObserver === 'function' &&
        container.dataset.verifiedOwnerVisibilityGuard !== 'true'
      ) {
        container.dataset.verifiedOwnerVisibilityGuard = 'true';
        new MutationObserver(keepVisible).observe(container, {
          attributes: true,
          attributeFilter: ['style']
        });
      }
    }

    const readerReportAction = document.getElementById('readerReportAction');
    if (readerReportAction) readerReportAction.style.display = 'none';

    if (client) {
      for (const id of ['deleteNovel', 'deleteNovelTop']) {
        const button = document.getElementById(id);
        if (!button || button.dataset.verifiedOwnerSeriesFallback === 'true') continue;
        if (typeof button.onclick === 'function') continue;
        button.dataset.verifiedOwnerSeriesFallback = 'true';
        button.addEventListener('click', async () => {
          if (!globalThis.confirm('この作品とエピソードを削除しますか？この操作は元に戻せません。')) return;
          button.disabled = true;
          try {
            const result = await client
              .from('novels')
              .delete()
              .eq('id', novelId)
              .eq('user_id', userId);
            if (result.error) throw result.error;
            globalThis.location.href = 'my-novels.html';
          } catch (error) {
            console.error('verified owner series delete failed', error);
            globalThis.alert('作品を削除できませんでした。時間をおいて再度お試しください。');
            button.disabled = false;
          }
        });
      }
    }

    const reportButton = document.getElementById('reportOpenTop');
    if (reportButton && typeof globalThis.openReport === 'function') {
      reportButton.onclick = globalThis.openReport;
    }
  }

  function waitForOwnerSurface(callback) {
    let completed = false;
    let observer = null;
    const run = () => {
      if (completed) return;
      if (!document.querySelector('#novelHeader .title')) return;
      completed = true;
      observer?.disconnect();
      callback();
    };
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(run);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    run();
    setTimeout(run, 12000);
  }

  async function verifyOwnerWithClient(client, novelId) {
    if (!client) return null;
    const auth = await client.auth.getUser();
    const userId = auth.data?.user?.id;
    if (auth.error || !userId) {
      throw auth.error || new Error('authenticated user unavailable');
    }

    const ownership = await client
      .from('novels')
      .select('id,user_id')
      .eq('id', novelId)
      .maybeSingle();
    if (ownership.error) throw ownership.error;
    if (!ownership.data || String(ownership.data.user_id) !== String(userId)) return null;
    return { userId };
  }

  async function restoreVerifiedOwnerActions(attempt = 0) {
    const page = (globalThis.location?.pathname?.split('/').pop() || '').toLowerCase();
    if (page !== 'novel.html' && page !== 'novel') return;
    const novelId = new URLSearchParams(globalThis.location.search).get('id');
    if (!novelId) return;
    const client = makeOwnerRecoveryClient();

    try {
      let verified = null;
      let clientError = null;
      try {
        verified = await verifyOwnerWithClient(client, novelId);
      } catch (error) {
        clientError = error;
      }

      if (!verified) {
        try {
          verified = await verifyOwnerViaRest(novelId);
        } catch (restError) {
          if (clientError) {
            throw new AggregateError(
              [clientError, restError],
              'verified owner recovery paths unavailable'
            );
          }
          throw restError;
        }
      }
      if (!verified) return;

      waitForOwnerSurface(() =>
        configureVerifiedOwnerActions(client, novelId, verified.userId)
      );
    } catch (error) {
      if (attempt + 1 < OWNER_RECOVERY_ATTEMPTS) {
        setTimeout(() => {
          void restoreVerifiedOwnerActions(attempt + 1);
        }, OWNER_RECOVERY_RETRY_MS);
        return;
      }
      console.warn('verified owner series recovery unavailable', error);
    }
  }

  async function fetchContext(client, novelId) {
    const result = await client.rpc('novelight_public_series_context', {
      p_novel_id: String(novelId)
    });
    if (result.error) throw result.error;
    return Array.isArray(result.data) ? result.data : [];
  }

  async function mountNovelContext(client, novelId) {
    const episodesPanel = document.getElementById('episodesPanel');
    if (!episodesPanel) return;

    document.getElementById('novelightSeriesContext')?.remove();

    let rows;
    try {
      rows = await fetchContext(client, novelId);
    } catch (error) {
      console.error('series context unavailable', error);
      return;
    }
    if (!rows.length) return;

    rows.sort((a, b) => Number(a.item_position) - Number(b.item_position));
    const currentIndex = rows.findIndex((row) => row.is_current);
    if (currentIndex < 0) return;

    const current = rows[currentIndex];
    const previous = rows[currentIndex - 1] || null;
    const next = rows[currentIndex + 1] || null;
    const panel = document.createElement('section');
    panel.id = 'novelightSeriesContext';
    panel.className = 'panel novelight-series-context';
    panel.innerHTML =
      `<h2>シリーズ：${esc(current.series_title)}</h2>` +
      (current.series_description
        ? `<div class="series-description">${esc(current.series_description)}</div>`
        : '') +
      '<ol>' +
      rows
        .map(
          (row) =>
            `<li class="${row.is_current ? 'current' : ''}"><a href="novel.html?id=${encodeURIComponent(row.item_novel_id)}">${esc(row.item_title)}</a>${row.is_current ? '（現在）' : ''}</li>`
        )
        .join('') +
      '</ol>' +
      '<nav class="novelight-series-nav" aria-label="シリーズ内の作品移動">' +
      (previous
        ? `<a href="novel.html?id=${encodeURIComponent(previous.item_novel_id)}">← 前の作品<br>${esc(previous.item_title)}</a>`
        : '<span></span>') +
      (next
        ? `<a class="next" href="novel.html?id=${encodeURIComponent(next.item_novel_id)}">次の作品 →<br>${esc(next.item_title)}</a>`
        : '<span></span>') +
      '</nav>';

    ensureStyles();
    episodesPanel.parentNode.insertBefore(panel, episodesPanel);
  }

  window.NovelightSeries = Object.freeze({ fetchContext, mountNovelContext });

  void restoreVerifiedOwnerActions();

  if (!document.querySelector('script[data-novelight-entry-number-visibility]')) {
    const script = document.createElement('script');
    script.src = 'novelight-episode-number-entry-visibility.js?v=20261004-owner-actions-v3';
    script.dataset.novelightEntryNumberVisibility = 'true';
    document.head.appendChild(script);
  }
})();