(function attachEpisodeEntryNumberVisibility(global) {
  'use strict';

  if (global.__novelightEpisodeEntryNumberVisibilityLoaded) return;
  global.__novelightEpisodeEntryNumberVisibilityLoaded = true;

  const SUPABASE_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
  const STYLE_ID = 'novelight-entry-number-visibility-style';

  function pageName() {
    return (global.location?.pathname?.split('/').pop() || '').toLowerCase();
  }

  function missingColumn(error, column) {
    const message = String(error?.message || '');
    return error?.code === '42703'
      || error?.code === 'PGRST204'
      || message.includes(column)
      || message.includes('does not exist');
  }

  function installStyle() {
    if (!global.document?.head || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.novelight-entry-number-hidden{display:none!important}' +
      '.novelight-hide-auto-episode-numbers #episodeList .episode-number{display:none!important}' +
      '.novelight-hide-auto-episode-numbers #card>.number{display:none!important}';
    document.head.appendChild(style);
  }

  function makeClient() {
    if (!global.supabase?.createClient) return null;
    return global.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  async function novelShowsNumbers(client, novelId) {
    const result = await client
      .from('novels')
      .select('show_episode_numbers')
      .eq('id', Number(novelId))
      .maybeSingle();
    if (result.error) {
      if (!missingColumn(result.error, 'show_episode_numbers')) {
        console.warn('work episode-number visibility unavailable', result.error);
      }
      return true;
    }
    return result.data?.show_episode_numbers !== false;
  }

  function waitForRendered(selector, callback) {
    let done = false;
    function run() {
      if (done) return;
      const node = document.querySelector(selector);
      if (!node) return;
      done = true;
      observer?.disconnect();
      callback(node);
    }
    const observer = typeof MutationObserver === 'function'
      ? new MutationObserver(run)
      : null;
    observer?.observe(document.documentElement, { childList: true, subtree: true });
    run();
    if (!done) setTimeout(() => {
      observer?.disconnect();
      run();
    }, 12000);
  }

  async function applyEpisodePage(client) {
    const episodeId = new URLSearchParams(global.location.search).get('id');
    if (!episodeId) return;

    let episodeResult = await client
      .from('episodes')
      .select('id,novel_id,show_episode_number')
      .eq('id', episodeId)
      .maybeSingle();
    let showEntryNumber = true;
    let novelId = episodeResult.data?.novel_id;

    if (episodeResult.error && missingColumn(episodeResult.error, 'show_episode_number')) {
      episodeResult = await client
        .from('episodes')
        .select('id,novel_id')
        .eq('id', episodeId)
        .maybeSingle();
      novelId = episodeResult.data?.novel_id;
    } else if (episodeResult.error) {
      console.warn('episode-number visibility unavailable', episodeResult.error);
      return;
    } else {
      showEntryNumber = episodeResult.data?.show_episode_number !== false;
    }

    if (!novelId) return;
    const showWorkNumbers = await novelShowsNumbers(client, novelId);
    installStyle();
    document.documentElement.classList.toggle(
      'novelight-hide-auto-episode-numbers',
      !showWorkNumbers
    );
    waitForRendered('#card>.number', (number) => {
      number.classList.toggle('novelight-entry-number-hidden', !showEntryNumber);
    });
  }

  function applyNovelRows(rows) {
    const hiddenIds = new Set(
      (rows || [])
        .filter((row) => row.show_episode_number === false)
        .map((row) => String(row.id))
    );

    function sync() {
      document.querySelectorAll('#episodeList .episode').forEach((card) => {
        const link = card.querySelector('a[href*="episode.html?id="]');
        const number = card.querySelector('.episode-number');
        if (!link || !number) return;
        let episodeId = '';
        try {
          episodeId = new URL(link.getAttribute('href'), global.location.href).searchParams.get('id') || '';
        } catch {}
        number.classList.toggle('novelight-entry-number-hidden', hiddenIds.has(String(episodeId)));
      });
    }

    sync();
    if (typeof MutationObserver === 'function') {
      const root = document.getElementById('episodeList');
      if (root) new MutationObserver(sync).observe(root, { childList: true, subtree: true });
      else waitForRendered('#episodeList', (node) => {
        sync();
        new MutationObserver(sync).observe(node, { childList: true, subtree: true });
      });
    }
  }

  async function applyNovelPage(client) {
    const novelId = new URLSearchParams(global.location.search).get('id');
    if (!novelId) return;
    const showWorkNumbers = await novelShowsNumbers(client, novelId);
    installStyle();
    document.documentElement.classList.toggle(
      'novelight-hide-auto-episode-numbers',
      !showWorkNumbers
    );

    const result = await client
      .from('episodes')
      .select('id,show_episode_number')
      .eq('novel_id', Number(novelId))
      .eq('status', 'published');
    if (result.error) {
      if (!missingColumn(result.error, 'show_episode_number')) {
        console.warn('per-episode number visibility unavailable', result.error);
      }
      return;
    }
    applyNovelRows(result.data || []);
  }

  async function start() {
    const client = makeClient();
    if (!client) return;
    try {
      const page = pageName();
      if (page === 'episode.html' || page === 'episode') {
        await applyEpisodePage(client);
      } else if (page === 'novel.html' || page === 'novel') {
        await applyNovelPage(client);
      }
    } catch (error) {
      console.warn('episode entry number visibility failed', error);
    }
  }

  void start();
})(typeof window === 'undefined' ? globalThis : window);
