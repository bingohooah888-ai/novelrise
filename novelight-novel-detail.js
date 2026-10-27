(function () {
  'use strict';

  const STYLE_ID = 'novelight-novel-detail-v2-style';

  function currentNovelId() {
    return new URLSearchParams(window.location.search).get('id');
  }

  function waitFor(selector, { timeout = 0, root = document } = {}) {
    const found = root.querySelector(selector);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const foundNode = root.querySelector(selector);
        if (!foundNode) return;
        observer.disconnect();
        if (timer) clearTimeout(timer);
        resolve(foundNode);
      });
      observer.observe(root === document ? document.documentElement : root, {
        childList: true,
        subtree: true
      });
      const timer = timeout > 0
        ? window.setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timed out waiting for ${selector}`));
          }, timeout)
        : null;
    });
  }

  function waitForEpisodeResults(timeout = 8000) {
    const list = document.getElementById('episodeList');
    if (!list) return Promise.resolve(false);
    const settled = () => {
      if (list.querySelector('.episode a[href*="episode.html?id="], .error')) return true;
      const empty = list.querySelector('.empty');
      return Boolean(empty && !/読み込み中/u.test(empty.textContent || ''));
    };
    if (settled()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let timer;
      const observer = new MutationObserver(() => {
        if (!settled()) return;
        observer.disconnect();
        clearTimeout(timer);
        resolve(true);
      });
      observer.observe(list, { childList: true, subtree: true, characterData: true });
      timer = window.setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeout);
    });
  }

  function node(tag, className = '', text = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== '') element.textContent = String(text);
    return element;
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      body.nl-work-detail-v2{background:#f6f3ed;color:#2f2923}
      body.nl-work-detail-v2 main{max-width:1480px!important;padding:34px 24px 76px!important}
      .nl-work-detail-grid{display:grid;grid-template-columns:minmax(180px,230px) minmax(0,1fr) minmax(300px,380px);gap:24px;align-items:stretch;margin:0 auto 18px}
      .nl-work-detail-left{position:static;display:grid;gap:14px;min-width:0}
      .nl-work-detail-cover{width:100%;aspect-ratio:2/3;border-radius:13px;overflow:hidden;background:linear-gradient(145deg,#f0eadf,#ddd2c1);border:1px solid #d8ccbb;box-shadow:0 18px 36px rgba(52,39,26,.14);display:grid;place-items:center}
      .nl-work-detail-cover img{width:100%;height:100%;display:block;object-fit:cover}
      .nl-work-detail-cover-placeholder{display:grid;place-items:center;width:100%;height:100%;padding:28px;text-align:center;color:#776858;font-weight:900;letter-spacing:.12em;font-size:13px}
      .nl-work-detail-left .tags{display:flex;gap:6px;flex-wrap:wrap;margin:0}
      .nl-work-detail-left .tag,.nl-work-detail-left .novelight-work-tag{font-size:10px}
      .nl-work-tag-more{border:1px solid #d6ccbf;border-radius:999px;background:#fffdfa;color:#67594b;padding:5px 9px;font:inherit;font-size:10px;font-weight:900;cursor:pointer}
      .nl-work-detail-bookmeta{display:grid;gap:6px;padding:13px 14px;border:1px solid #e2d9cd;border-radius:12px;background:#fffdfa;color:#706456;font-size:12px;line-height:1.5}
      .nl-work-detail-bookmeta strong{color:#3d3126}
      .nl-work-detail-center{min-width:0;min-height:0;display:flex;flex-direction:column;gap:18px}
      .nl-work-detail-main{flex:1 0 auto;padding:30px;background:#fffdfa;border:1px solid #e5ddd1;border-radius:16px;box-shadow:0 10px 32px rgba(55,43,31,.04)}
      .nl-work-detail-main > .title{display:block!important;visibility:visible!important;opacity:1!important;color:#30251c;font-size:clamp(25px,2vw,34px);line-height:1.14;margin-bottom:12px;letter-spacing:.005em;text-wrap:pretty}
      .nl-work-detail-main > .author{display:flex!important;visibility:visible!important;opacity:1!important;margin-bottom:17px;color:#746b62}
      .nl-work-detail-main .meta{width:100%;margin:0 0 18px;padding:12px 0;border-top:1px solid #eee7dc;border-bottom:1px solid #eee7dc;color:#7d746a}
      .nl-work-detail-synopsis{margin:4px 0 22px;padding-top:2px}
      .nl-work-detail-kicker{margin-bottom:8px;color:#9a7b4e;font-size:11px;font-weight:900;letter-spacing:.14em}
      .nl-work-detail-synopsis h2,.nl-work-character-section h2{font-size:20px;margin:0 0 11px}
      .nl-work-detail-synopsis .description{margin:0;color:#4f4942;line-height:1.9;white-space:pre-wrap}
      .nl-work-detail-synopsis .novelight-native-synopsis{margin-bottom:0}
      .nl-work-detail-synopsis .novelight-native-synopsis>summary{display:block;list-style:none;cursor:pointer}
      .nl-work-detail-synopsis .novelight-native-synopsis>summary::-webkit-details-marker{display:none}
      .nl-work-detail-synopsis .novelight-native-synopsis-preview{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;color:#4f4942;line-height:1.9}
      .nl-work-detail-synopsis .novelight-native-synopsis-label{display:inline-block;margin-top:6px;color:#76500d;font-size:13px;font-weight:800;text-decoration:underline;text-underline-offset:3px}
      .nl-work-detail-synopsis .novelight-native-synopsis[open] .novelight-native-synopsis-preview,
      .nl-work-detail-synopsis .novelight-native-synopsis[open] .novelight-native-synopsis-more,
      .nl-work-detail-synopsis .novelight-native-synopsis:not([open]) .novelight-native-synopsis-less{display:none}
      .nl-work-detail-synopsis .novelight-native-synopsis>.description{display:block!important;overflow:visible!important;max-height:none!important;-webkit-line-clamp:unset!important;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9;margin:12px 0 0}
      .nl-work-detail-actions{display:flex;align-items:stretch;gap:8px;flex-wrap:wrap;margin-top:0;padding-top:18px;border-top:1px solid #eee7dc}
      .nl-work-detail-actions .favorite,.nl-work-detail-actions .nl-book-control-button,.nl-work-detail-actions .novelight-curation-add-button,.nl-work-toc-mobile-button,.nl-work-more-actions>summary{min-height:42px;padding:9px 12px;border:1px solid #d7ccbd;border-radius:10px;background:#fff;color:#4b3b2c;font:inherit;font-size:12px;font-weight:900;cursor:pointer}
      .nl-work-detail-actions .nl-book-control{display:contents!important}
      .nl-work-detail-actions .nl-book-panel,.nl-work-detail-actions .novelight-curation-add-panel{flex:1 0 100%;order:30;width:100%}
      .nl-work-read-action{order:-20;display:flex;align-items:center;justify-content:space-between;gap:14px;flex:1 1 100%;min-height:60px;padding:14px 17px;border-radius:11px;background:#3b2a1d;color:#fff!important;text-decoration:none!important;font-size:16px;font-weight:900}
      .nl-work-read-action small{display:block;margin-top:3px;color:#dfd1c1;font-size:10px;font-weight:700}
      .nl-work-more-actions{position:relative;margin:0;padding:0}.nl-work-more-actions>summary{display:flex;align-items:center;justify-content:center;list-style:none;white-space:nowrap}.nl-work-more-actions>summary::-webkit-details-marker{display:none}
      .nl-work-more-menu{position:absolute;right:0;top:calc(100% + 7px);z-index:45;min-width:190px;display:grid;gap:3px;padding:7px;border:1px solid #ddd8cf;border-radius:10px;background:#fff;box-shadow:0 12px 30px rgba(31,26,18,.16)}
      .nl-work-more-actions:not([open]) .nl-work-more-menu{display:none}.nl-work-more-menu .nl-work-share-button,.nl-work-more-menu .nl-work-report-button{display:flex;align-items:center;justify-content:flex-start;width:100%;min-height:36px;padding:8px 10px;border:0;border-radius:7px;background:#fff;color:#4b3b2c;text-decoration:none;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.nl-work-more-menu .nl-work-share-button:hover,.nl-work-more-menu .nl-work-report-button:hover{background:#f5f1eb}
      .nl-work-detail-toc{position:static;height:100%;min-height:0;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;padding:19px;border:1px solid #e2d9cd;border-radius:16px;background:#fffdfa;box-shadow:0 10px 30px rgba(52,42,31,.05)}
      .nl-work-detail-toc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
      .nl-work-detail-toc h2{font-size:19px;margin:0}.nl-work-detail-toc-count{color:#667284;font-size:12px}
      .nl-work-toc-list{display:grid;gap:5px;grid-auto-rows:max-content;align-content:start;flex:1 1 0%;height:0;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding-right:4px;scrollbar-width:thin;scrollbar-color:#aeb7c3 transparent}.nl-work-toc-list::-webkit-scrollbar{width:7px}.nl-work-toc-list::-webkit-scrollbar-track{background:transparent}.nl-work-toc-list::-webkit-scrollbar-thumb{background:#aeb7c3;border-radius:999px}.nl-work-toc-group{border:1px solid #e4dccf;border-radius:9px;overflow:hidden;margin:7px 0}.nl-work-toc-chapter{display:block;margin:0;padding:10px 12px;border-left:3px solid #b28a4a;background:#f4f6f8;color:#26364b;font-size:13px;font-weight:900;line-height:1.5;cursor:pointer;list-style:none}.nl-work-toc-chapter::-webkit-details-marker{display:none}.nl-work-toc-chapter::after{content:'＋';float:right}.nl-work-toc-group[open]>.nl-work-toc-chapter::after{content:'－'}.nl-work-toc-chapter:focus-visible{outline:2px solid #7351d8;outline-offset:-2px}.nl-work-toc-chapter-episodes{padding:5px 8px}
      .nl-work-toc-link{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:start;padding:9px 10px;border-radius:8px;color:#26364b!important;text-decoration:none!important;font-size:15px;line-height:1.5}
      .nl-work-toc-link.is-draft{grid-template-columns:auto minmax(0,1fr) auto;background:#fff0f5!important;border:1px solid #e8b8ca;color:#78334e!important;box-shadow:inset 3px 0 0 #d98baa}
      .nl-work-toc-link.is-draft:hover{background:#ffe5ef!important}
      .nl-work-toc-draft-badge{grid-column:3;grid-row:1;justify-self:start;padding:2px 9px;border-radius:999px;background:#f5c5d7;color:#813951;font-size:11px;font-weight:800}
      .nl-work-toc-link:hover{background:#f2f5f8}.nl-work-toc-link.is-read{color:#5b6675!important}.nl-work-toc-link.is-current{background:#edf1f6;color:#15243a!important;font-weight:900;box-shadow:inset 3px 0 0 #b28a4a}.nl-work-toc-num{white-space:nowrap;color:#5f6b7a;font-size:12px;padding-top:2px}
      body.nl-work-detail-v2 #episodesPanel{display:none!important}
      .nl-work-character-section{padding:24px;background:#fffdfa;border:1px solid #e5ddd1;border-radius:16px;box-shadow:0 10px 32px rgba(55,43,31,.04)}
      .nl-work-character-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:15px}.nl-work-character-head p{margin:0;color:#7d746a;font-size:12px;line-height:1.6}
      .nl-work-character-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.nl-work-character-card{display:grid;grid-template-columns:56px minmax(0,1fr);gap:12px;align-items:center;padding:12px;border:1px solid #e7dfd4;border-radius:12px;background:#fff}.nl-work-character-image,.nl-work-character-fallback{width:56px;height:56px;border-radius:10px;object-fit:cover;background:#efe9df;display:grid;place-items:center;color:#7a6855;font-weight:900;font-size:19px}.nl-work-character-copy strong{display:block;margin-bottom:4px;font-size:14px}.nl-work-character-copy p{margin:0;color:#786f66;font-size:11px;line-height:1.55}.nl-work-character-more{margin-top:12px;border:0;background:transparent;color:#70542d;font:inherit;font-size:12px;font-weight:900;cursor:pointer;padding:4px 0}.nl-work-character-card.is-extra{display:none}.nl-work-character-grid.is-expanded .nl-work-character-card.is-extra{display:grid}
      .nl-work-support-stack{max-width:1440px;margin:0 auto}.nl-work-support-stack #lightSeedArea,.nl-work-support-stack #receivedSeedArea,.nl-work-support-stack #novelPollArea{margin-bottom:18px}.nl-work-support-stack #lightSeedArea{padding:18px 20px;background:#fffdfa;border-color:#e4dac9}.nl-work-support-stack .seed-types{gap:7px;margin-top:12px}.nl-work-support-stack .seed-choice{min-height:60px;padding:9px}.nl-work-support-stack .received-seed-panel{padding:20px}
      .nl-work-toc-mobile-button{display:none}.nl-work-toc-dialog{border:0;padding:0;background:transparent;max-width:none;max-height:none;width:100%;height:100%;margin:0}.nl-work-toc-dialog::backdrop{background:rgba(30,24,18,.48)}.nl-work-toc-sheet{position:absolute;left:0;right:0;bottom:0;max-height:82vh;overflow:auto;border-radius:20px 20px 0 0;background:#fffdfa;padding:18px 16px 28px;box-shadow:0 -18px 46px rgba(28,22,17,.18)}.nl-work-toc-sheet-head{position:sticky;top:-18px;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-18px -16px 10px;padding:17px 16px 12px;background:#fffdfa;border-bottom:1px solid #eee6db}.nl-work-toc-sheet-head h2{font-size:18px;margin:0}.nl-work-toc-close{border:1px solid #d8cec1;border-radius:999px;background:#fff;width:36px;height:36px;font-size:20px;cursor:pointer}
      .nl-work-cover-owner-link{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:38px;padding:8px 10px;border:1px solid #d7ccbd;border-radius:9px;background:#fffdfa;color:#4b3b2c!important;text-decoration:none!important;font-size:12px;font-weight:900}
      .nl-work-detail-left-support{display:grid;gap:12px;min-width:0}.nl-work-detail-left-support:empty{display:none}
      /* Character cards take their own row. Only the main work card
         defines the left column height; the TOC spans both rows. */
      @media(min-width:1051px){
        .nl-work-detail-grid:has(.nl-work-character-section){grid-template-areas:"left detail toc" ". characters toc";row-gap:18px}
        .nl-work-detail-grid:has(.nl-work-character-section) .nl-work-detail-center{display:contents}
        .nl-work-detail-grid:has(.nl-work-character-section) .nl-work-detail-left{grid-area:left;display:flex;flex-direction:column;justify-content:flex-start}
        .nl-work-detail-grid:has(.nl-work-character-section) .nl-work-detail-main{grid-area:detail;flex:initial}
        .nl-work-detail-grid:has(.nl-work-character-section) .nl-work-character-section{grid-area:characters}
        .nl-work-detail-grid:has(.nl-work-character-section) .nl-work-detail-toc{grid-area:toc;height:auto;align-self:stretch;contain:size}
      }
      @media(max-width:1050px){body.nl-work-detail-v2 main{max-width:980px!important}.nl-work-detail-grid{grid-template-columns:210px minmax(0,1fr)}.nl-work-detail-toc{grid-column:1/-1;height:auto;max-height:min(70vh,680px)}.nl-work-toc-list{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:14px;height:auto;flex:1 1 auto;min-height:0;overflow-y:auto;padding-right:4px}.nl-work-toc-group{grid-column:1/-1}}
      @media(max-width:760px){body.nl-work-detail-v2 main{padding:22px 14px 60px!important}.nl-work-detail-grid{grid-template-columns:1fr;gap:16px}.nl-work-detail-left{position:static;display:grid;place-items:center}.nl-work-detail-cover{width:min(64vw,230px)}.nl-work-detail-left .tags,.nl-work-detail-bookmeta,.nl-work-detail-left-support{width:100%}.nl-work-detail-main{padding:22px 18px}.nl-work-detail-main .title{font-size:clamp(24px,6.4vw,31px);line-height:1.18}.nl-work-detail-toc{display:none}.nl-work-toc-mobile-button{display:inline-flex;align-items:center;justify-content:center}.nl-work-character-grid{grid-template-columns:1fr}.nl-work-character-head{align-items:flex-start;flex-direction:column;gap:4px}.nl-work-detail-actions{display:grid;grid-template-columns:1fr 1fr}.nl-work-read-action{grid-column:1/-1}.nl-work-detail-actions .nl-book-panel,.nl-work-detail-actions .novelight-curation-add-panel{grid-column:1/-1}.nl-work-more-actions{position:relative}.nl-work-more-menu{right:0;left:auto}}
      @media(max-width:430px){.nl-work-detail-actions{grid-template-columns:1fr}.nl-work-detail-actions>*{width:100%}.nl-work-more-menu{left:0;right:0;width:100%}}
    `;
    document.head.appendChild(style);
  }

  function episodeRows() {
    return Array.from(document.querySelectorAll('#episodeList .episode')).map((episode) => {
      const link = episode.querySelector('a[href*="episode.html?id="]');
      const numberText = episode.querySelector('.episode-number')?.textContent || '';
      const match = numberText.match(/第\s*(\d+)\s*話/u);
      if (!link || !match) return null;
      const url = new URL(link.href, window.location.href);
      return { id: url.searchParams.get('id'), number: Number(match[1]), title: link.textContent.trim(), href: link.href, element: episode, status: episode.dataset.episodeStatus === 'draft' || numberText.includes('下書き') ? 'draft' : 'published' };
    }).filter(Boolean);
  }

  function outlineItems(rows) {
    const rowByElement = new Map(rows.map((row) => [row.element, row]));
    const items = [];
    document.querySelectorAll('#episodeList > .chapter-heading, #episodeList > .episode').forEach((element) => {
      if (element.classList.contains('chapter-heading')) items.push({ type: 'chapter', title: element.textContent.trim() });
      else if (rowByElement.has(element)) items.push({ type: 'episode', row: rowByElement.get(element) });
    });
    return items;
  }

  function readProgress(id) {
    return window.NovelightReadingContinuity?.readProgress?.(id) || null;
  }

  async function syncProgress(id) {
    try { await window.NovelightReadingContinuity?.hydrateRemoteProgress?.(client, [id]); }
    catch (error) { console.warn('detail progress sync unavailable', error); }
  }

  function continueTarget(rows, progress) {
    const apiTarget = window.NovelightReadingContinuity?.continueTarget?.(
      rows.map((row) => ({ id: row.id, href: row.href, episodeNumber: row.number, title: row.title })),
      progress
    );
    if (apiTarget) return apiTarget;
    if (!rows.length) return null;
    if (!progress) return { row: { ...rows[0], episodeNumber: rows[0].number }, label: `第${rows[0].number}話から読む`, unread: rows.length };
    const index = rows.findIndex((row) => String(row.id) === String(progress.episodeId));
    if (index < 0) return { row: { ...rows[0], episodeNumber: rows[0].number }, label: `第${rows[0].number}話から読む`, unread: rows.length };
    const complete = Number(progress.progressRatio || 0) >= .85;
    const next = complete && rows[index + 1] ? rows[index + 1] : rows[index];
    return { row: { ...next, episodeNumber: next.number }, label: next === rows[index] ? `第${next.number}話の続きから読む` : `第${next.number}話から続きを読む`, unread: Math.max(0, rows.length - index - (complete ? 1 : 0)) };
  }

  const tocDisplayTitle = window.NovelightEpisodeTitleDisplay.visibleTitle;

  function buildToc(items, id, { isOwner = false } = {}) {
    const wrap = node('div', 'nl-work-toc-list');
    // Owners navigate their own work; reading progress must not preselect a later chapter.
    const progress = isOwner ? null : readProgress(id);
    const currentNumber = Number(progress?.episodeNumber) || 0;
    const currentId = progress?.episodeId ? String(progress.episodeId) : '';
    let chapterBody = wrap;
    let chapterOrdinal = 0;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.type === 'chapter') {
        chapterOrdinal += 1;
        const group = node('details', 'nl-work-toc-group');
        const summary = node('summary', 'nl-work-toc-chapter', item.title || `第${chapterOrdinal}章`);
        const body = node('div', 'nl-work-toc-chapter-episodes');
        const nextChapter = items.findIndex((candidate, index) => index > i && candidate.type === 'chapter');
        const end = nextChapter < 0 ? items.length : nextChapter;
        group.open = items.slice(i + 1, end).some((candidate) =>
          candidate.type === 'episode' && String(candidate.row.id) === currentId
        ) || (!currentId && chapterOrdinal === 1);
        group.append(summary, body);
        wrap.appendChild(group);
        chapterBody = body;
        continue;
      }
      const row = item.row;
      const link = node('a', 'nl-work-toc-link');
      link.href = row.status === 'draft' && isOwner ? 'episode-edit.html?id=' + encodeURIComponent(row.id) : row.href;
      if (row.status === 'draft' && isOwner) link.classList.add('is-draft');
      if (currentNumber && row.number <= currentNumber) link.classList.add('is-read');
      if (currentId && String(row.id) === currentId) link.classList.add('is-current');
      link.appendChild(node('span', 'nl-work-toc-num', `第${row.number}話`));
      const displayTitle = tocDisplayTitle(row.title, row.number);
      if (displayTitle) link.appendChild(node('span', '', displayTitle));
      if (row.status === 'draft' && isOwner) link.appendChild(node('span', 'nl-work-toc-draft-badge', '下書き'));
      chapterBody.appendChild(link);
    }
    return wrap;
  }

  function optimizedImageUrl(url, width = 720, quality = 82) {
    const source = String(url || '').trim();
    if (!source || source.startsWith('/_vercel/image?')) return source;
    try {
      const parsed = new URL(source, window.location.origin);
      const sameOrigin = parsed.origin === window.location.origin;
      const supabaseStorage = parsed.hostname === 'fiepaguycecrredwrcwx.supabase.co' && parsed.pathname.startsWith('/storage/v1/object/');
      if (!sameOrigin && !supabaseStorage) return source;
      const optimizerSource = sameOrigin ? `${parsed.pathname}${parsed.search}` : parsed.href;
      return `/_vercel/image?url=${encodeURIComponent(optimizerSource)}&w=${width}&q=${quality}`;
    } catch {
      return source;
    }
  }

  async function coverCandidates(id) {
    const raw = [];
    const push = (value) => {
      const url = String(value || '').trim();
      if (url && !raw.includes(url)) raw.push(url);
    };
    try {
      const custom = await client.from('novel_custom_covers')
        .select('storage_path').eq('novel_id', Number(id)).maybeSingle();
      const path = String(custom.data?.storage_path || '');
      if (!custom.error && /^[0-9a-f-]{36}\/[0-9]+\/[0-9a-f-]{36}\.(?:webp|png|jpg)$/u.test(path)) {
        const url = client.storage.from('novel-custom-covers').getPublicUrl(path);
        push(url.data?.publicUrl);
      }
      let composition = await client.rpc('novelight_thumbnail_compositions_v3', { p_novel_ids: [String(id)] });
      if (['42883', '42P01', '42703'].includes(String(composition.error?.code || ''))) {
        composition = await client.rpc('novelight_thumbnail_compositions_v2', { p_novel_ids: [String(id)] });
      }
      if (!composition.error) {
        const first = Array.isArray(composition.data) ? composition.data[0] : null;
        push(first?.render_url);
        push(first?.blob_url);
        push(first?.hero_image_url);
        push(first?.base_image_url);
      }
    } catch (error) {
      console.warn('optional artwork candidates unavailable', error);
    }
    // Keep custom author covers ahead of official artwork, but don't let an
    // optional lookup error suppress the saved publication thumbnail.
    if (typeof novel !== 'undefined' && String(novel?.id) === String(id)) {
      push(novel.thumbnail_url);
    }
    try {
      const direct = await client.from('novels').select('thumbnail_url').eq('id', id).maybeSingle();
      if (!direct.error) push(direct.data?.thumbnail_url);
    } catch (error) {
      console.warn('saved thumbnail lookup unavailable', error);
    }
    const candidates = [];
    raw.forEach((url) => {
      const optimized = optimizedImageUrl(url, 384, 75);
      if (optimized && !candidates.includes(optimized)) candidates.push(optimized);
      if (url && !candidates.includes(url)) candidates.push(url);
    });
    return candidates;
  }

  function coverPlaceholder(cover) {
    cover.replaceChildren(node('div', 'nl-work-detail-cover-placeholder', 'NOVELIGHT'));
  }

  async function mountCover(id, cover) {
    // Display the novel's saved thumbnail before any optional network lookups.
    const saved = typeof novel !== 'undefined' && String(novel?.id) === String(id)
      ? String(novel.thumbnail_url || '').trim() : '';
    if (saved) {
      const initial = node('img');
      initial.alt = '';
      initial.loading = 'eager';
      initial.decoding = 'async';
      initial.addEventListener('error', () => {
        // A missing saved asset should not leave a broken image in the cover.
        if (cover.firstElementChild === initial) coverPlaceholder(cover);
      }, { once: true });
      initial.src = saved;
      cover.replaceChildren(initial);
    }
    const candidates = await coverCandidates(id);
    if (!candidates.length) {
      if (!saved) coverPlaceholder(cover);
      return;
    }
    let index = 0;
    const tryNext = () => {
      if (index >= candidates.length) {
        // Retain a working saved cover if every optional image fails.
        if (!saved && !cover.querySelector('img')) coverPlaceholder(cover);
        return;
      }
      const image = node('img');
      image.alt = '';
      image.decoding = 'async';
      image.loading = 'eager';
      image.fetchPriority = 'high';
      image.addEventListener('load', () => {
        // Only replace a displayed image after its replacement loads.
        cover.replaceChildren(image);
      }, { once: true });
      image.addEventListener('error', () => {
        index += 1;
        tryNext();
      }, { once: true });
      image.src = candidates[index];
    };
    tryNext();
  }

  function collapseTags(tags) {
    const tagItems = Array.from(tags.children).filter((element) => element.matches('.tag,.novelight-work-tag'));
    if (tagItems.length <= 8) return;
    tagItems.slice(8).forEach((element) => { element.hidden = true; });
    const more = node('button', 'nl-work-tag-more', `＋${tagItems.length - 8}`);
    more.type = 'button';
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => {
      const expanded = more.getAttribute('aria-expanded') === 'true';
      tagItems.slice(8).forEach((element) => { element.hidden = expanded; });
      more.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      more.textContent = expanded ? `＋${tagItems.length - 8}` : '閉じる';
    });
    tags.appendChild(more);
  }

  function stripReaderPv(meta) {
    Array.from(meta.querySelectorAll('*')).forEach((element) => {
      if (!element.children.length && /\bPV\b/iu.test(element.textContent || '')) element.remove();
    });
    const walker = document.createTreeWalker(meta, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((textNode) => {
      textNode.nodeValue = String(textNode.nodeValue || '')
        .replace(/(?:👁|👁️)?\s*[\d,]+\s*PV\s*/giu, '')
        .replace(/\s{2,}/gu, ' ');
    });
  }

  function installMobileToc(items, id, actions, isOwner = false) {
    const button = node('button', 'nl-work-toc-mobile-button', '目次を見る');
    button.type = 'button';
    const dialog = node('dialog', 'nl-work-toc-dialog');
    dialog.id = 'nlWorkTocDialog';
    const sheet = node('section', 'nl-work-toc-sheet');
    const head = node('div', 'nl-work-toc-sheet-head');
    const title = node('h2', '', '目次');
    const close = node('button', 'nl-work-toc-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '目次を閉じる');
    head.append(title, close);
    sheet.append(head, buildToc(items, id, { isOwner }));
    dialog.appendChild(sheet);
    document.body.appendChild(dialog);
    button.addEventListener('click', () => dialog.showModal());
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => button.focus());
    actions.appendChild(button);
  }

  function installSecondaryActions(actions, reportButton) {
    const details = node('details', 'nl-work-more-actions');
    details.id = 'nlWorkMoreActions';
    const summary = node('summary', '', '共有・その他');
    const menu = node('div', 'nl-work-more-menu');
    const copy = node('button', 'nl-work-share-button', 'URLをコピー');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
      } catch {
        const input = document.createElement('textarea');
        input.value = window.location.href;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
      copy.textContent = 'コピーしました';
      window.setTimeout(() => { copy.textContent = 'URLをコピー'; }, 1600);
    });
    const x = node('a', 'nl-work-share-button', 'Xで共有');
    const workId = new URLSearchParams(window.location.search).get('id');
    const publicUrl = workId
      ? `https://novelight.jp/novel.html?id=${encodeURIComponent(workId)}`
      : window.location.href;
    const workTitle = () =>
      document.querySelector('.nl-work-detail-main .title')?.textContent?.trim() ||
      document.title ||
      'NOVELIGHTの作品';
    x.target = '_blank';
    x.rel = 'noopener noreferrer';
    x.href = `https://x.com/intent/post?text=${encodeURIComponent(workTitle())}&url=${encodeURIComponent(publicUrl)}`;
    const prepareCover = () => {
      // Mobile and desktop both use the same published OG link card.
      void window.NovelightXImageShare?.warm(publicUrl);
    };
    x.addEventListener('pointerenter', prepareCover, { once: true });
    // Prepare as soon as the work detail is shown, including touch devices.
    prepareCover();
    x.addEventListener('click', (event) => {
      if (!window.NovelightXImageShare) return;
      event.preventDefault();
      void window.NovelightXImageShare.share({
        novelId: workId,
        title: workTitle(),
        url: publicUrl,
        onStatus: (message) => {
          // Only actionable failures/retry prompts belong in this compact menu.
          // Hide the verbose success tip after X opens.
          menu.querySelector('.nl-work-share-status')?.remove();
          if (
            !message ||
            (!message.includes('できません') && !message.includes('もう一度'))
          ) {
            return;
          }
          menu.appendChild(node('p', 'nl-work-share-status', message));
        }
      });
    });
    menu.append(copy, x);
    if (reportButton) {
      reportButton.classList.remove('action', 'report');
      reportButton.classList.add('nl-work-report-button');
      reportButton.textContent = '通報';
      menu.appendChild(reportButton);
    }
    details.append(summary, menu);
    actions.appendChild(details);
    return details;
  }

  async function ensureExistingControls(id, actions, secondaryActions) {
    try {
      if (!document.querySelector('.nl-book-control')) await window.NovelightBookshelf?.installNovelControl?.(client);
    } catch (error) {
      console.warn('bookshelf control unavailable', error);
    }
    try {
      if (!document.getElementById('curationAddButton') && typeof novel !== 'undefined') {
        await window.NovelightCuration?.mountNovelControl?.(client, novel, typeof session === 'undefined' ? null : session);
      }
    } catch (error) {
      console.warn('curation control unavailable', error);
    }
    const move = () => {
      const curation = document.getElementById('curationAddButton');
      const panel = document.getElementById('curationAddPanel');
      const book = document.querySelector('.nl-book-control');
      if (curation && curation.parentElement !== actions) actions.appendChild(curation);
      if (panel && panel.parentElement !== actions) actions.appendChild(panel);
      if (book && book.parentElement !== actions) actions.appendChild(book);
      if (
        secondaryActions?.parentElement === actions &&
        actions.lastElementChild !== secondaryActions
      ) {
        actions.appendChild(secondaryActions);
      }
    };
    move();
    const observer = new MutationObserver(move);
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 12000);
  }

  function installOwnerCoverLink(id, left) {
    const ownerActions = document.getElementById('ownerActionsTop');
    if (!ownerActions) return;
    const reveal = () => {
      const visible = ownerActions.style.display !== 'none' && !ownerActions.hidden;
      if (!visible || left.querySelector('.nl-work-cover-owner-link')) return;
      const link = node('a', 'nl-work-cover-owner-link', '表紙を設定');
      link.href = `work-cover.html?novel_id=${encodeURIComponent(id)}`;
      left.appendChild(link);
    };
    reveal();
    const observer = new MutationObserver(reveal);
    observer.observe(ownerActions, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    window.setTimeout(() => observer.disconnect(), 12000);
  }

  async function renderCharacters(rows, id, center) {
    if (!rows.length) return;
    const progress = readProgress(id);
    const boundary = rows.find((row) => String(row.id) === String(progress?.episodeId)) || rows[0];
    try {
      const result = await client.rpc('novelight_character_feed', { p_episode_id: String(boundary.id) });
      if (result.error) throw result.error;
      const characters = Array.isArray(result.data) ? result.data : [];
      if (!characters.length) return;
      const section = node('section', 'nl-work-character-section');
      const head = node('div', 'nl-work-character-head');
      const headingWrap = node('div');
      headingWrap.append(node('div', 'nl-work-detail-kicker', 'CHARACTERS'), node('h2', '', '登場人物'));
      head.append(headingWrap, node('p', '', '読んだ範囲までの人物だけを表示します。'));
      const characterGrid = node('div', 'nl-work-character-grid');
      characters.slice(0, 24).forEach((character, index) => {
        const card = node('article', `nl-work-character-card${index >= 6 ? ' is-extra' : ''}`);
        if (character.image_url) {
          const image = node('img', 'nl-work-character-image');
          image.src = String(character.image_url);
          image.alt = `${character.name || '登場人物'}の画像`;
          image.loading = 'lazy';
          image.decoding = 'async';
          image.referrerPolicy = 'no-referrer';
          image.addEventListener('error', () => {
            image.replaceWith(node('div', 'nl-work-character-fallback', String(character.name || '人').slice(0, 1)));
          }, { once: true });
          card.appendChild(image);
        } else {
          const fallback = node('div', 'nl-work-character-fallback', String(character.name || '人').slice(0, 1));
          fallback.setAttribute('aria-hidden', 'true');
          card.appendChild(fallback);
        }
        const copy = node('div', 'nl-work-character-copy');
        copy.append(
          node('strong', '', character.name || '登場人物'),
          node('p', '', character.description || (Number(character.latest_episode_number) ? `第${Number(character.latest_episode_number)}話までに登場` : '登場人物'))
        );
        card.appendChild(copy);
        characterGrid.appendChild(card);
      });
      section.append(head, characterGrid);
      if (characters.length > 6) {
        const more = node('button', 'nl-work-character-more', '登場人物をもっと見る →');
        more.type = 'button';
        more.addEventListener('click', () => {
          const expanded = characterGrid.classList.toggle('is-expanded');
          more.textContent = expanded ? '登場人物を閉じる ↑' : '登場人物をもっと見る →';
        });
        section.appendChild(more);
      }
      center.appendChild(section);
    } catch (error) {
      console.warn('character cards unavailable', error);
    }
  }

  async function boot() {
    if (!/(^|\/)novel\.html$/u.test(window.location.pathname) || document.body.classList.contains('nl-work-detail-v2')) return;
    const id = currentNovelId();
    if (!id) return;
    // Lock across duplicate script loads before any async DOM work.
    // Without this, two control-move observers can fight over the same nodes.
    if (window.__novelightDetailBootClaimed) return;
    window.__novelightDetailBootClaimed = true;
    await waitFor('#favoriteButton');
    // Wait for an actual episode link, error, or settled empty state. The
    // initial .empty node says "読み込み中..." and is NOT a finished response.
    if (!await waitForEpisodeResults()) return;
    const header = document.getElementById('novelHeader');
    const favorite = document.getElementById('favoriteButton');
    const title = header?.querySelector('.title');
    const tags = header?.querySelector('.tags');
    const author = header?.querySelector('.author');
    // Move the native <details> disclosure as a unit. Extracting only its
    // .description child detaches the preview/expander from its content.
    const description = header?.querySelector('.novelight-native-synopsis')
      || header?.querySelector('.description');
    const meta = header?.querySelector('.meta');
    const advisory = header?.querySelector('#contentAdvisory');
    if (!header || !favorite || !title || !tags || !author || !description || !meta) return;
    const rows = episodeRows();
    if (!rows.length) return;
    const viewerOwnsNovel = typeof isOwner === 'function' && isOwner();
    const workIsPublic = typeof novel !== 'undefined' && novel?.status === 'published';
    const publishedRows = rows.filter(row => row.status === 'published');
    const draftRows = viewerOwnsNovel ? rows.filter(row => row.status === 'draft') : [];
    const countLabel = viewerOwnsNovel && draftRows.length
      ? '公開' + publishedRows.length + '話・下書き' + draftRows.length + '話'
      : publishedRows.length + '話';
    const displayedCount = viewerOwnsNovel && !workIsPublic ? countLabel + '（作品非公開）' : countLabel;
    installStyles();
    document.body.classList.add('nl-work-detail-v2');
    stripReaderPv(meta);
    collapseTags(tags);
    const items = outlineItems(rows);
    if (!viewerOwnsNovel) await syncProgress(id);
    const target = viewerOwnsNovel ? null : continueTarget(publishedRows, readProgress(id));
    const grid = node('div', 'nl-work-detail-grid');
    grid.id = 'novelightWorkDetailGrid';
    header.insertAdjacentElement('beforebegin', grid);
    const left = node('aside', 'nl-work-detail-left');
    const cover = node('div', 'nl-work-detail-cover');
    cover.appendChild(node('div', 'nl-work-detail-cover-placeholder', 'NOVELIGHT'));
    left.append(cover, tags);
    const metaBox = node('div', 'nl-work-detail-bookmeta');
    metaBox.append(
      node('strong', '', workIsPublic ? (publishedRows.length ? '公開中' : '下書き管理中') : '作品非公開'),
      node('span', '', displayedCount),
      node('span', '', '作品情報・目次・読書状態を一冊にまとめて表示')
    );
    left.appendChild(metaBox);
    installOwnerCoverLink(id, left);
    const leftSupport = node('div', 'nl-work-detail-left-support');
    leftSupport.dataset.novelightLeftSupport = '';
    left.appendChild(leftSupport);
    const center = node('div', 'nl-work-detail-center');
    const main = node('section', 'nl-work-detail-main');
    main.append(title);
    if (advisory) main.appendChild(advisory);
    main.append(author, meta);
    const synopsis = node('div', 'nl-work-detail-synopsis');
    synopsis.append(node('div', 'nl-work-detail-kicker', 'STORY'), node('h2', '', 'あらすじ'), description);
    main.appendChild(synopsis);
    const actions = node('div', 'nl-work-detail-actions');
    if (target) {
      const read = node('a', 'nl-work-read-action');
      read.href = target.row.href;
      const readCopy = node('span', '', target.label);
      const readStatus = node('small', '', target.unread > 0 ? `未読 ${target.unread}話` : '最新話まで読了');
      readCopy.appendChild(readStatus);
      const arrow = node('span', '', '→');
      arrow.setAttribute('aria-hidden', 'true');
      read.append(readCopy, arrow);
      actions.appendChild(read);
    }
    actions.appendChild(favorite);
    installMobileToc(items, id, actions, viewerOwnsNovel);
    const secondaryActions = installSecondaryActions(actions, document.getElementById('readerReportOpen'));
    main.appendChild(actions);
    center.appendChild(main);
    const toc = node('aside', 'nl-work-detail-toc');
    toc.setAttribute('aria-label', '目次');
    const tocHead = node('div', 'nl-work-detail-toc-head');
    tocHead.append(node('h2', '', '目次'), node('span', 'nl-work-detail-toc-count', displayedCount));
    toc.append(tocHead, buildToc(items, id, { isOwner: viewerOwnsNovel }));
    grid.append(left, center, toc);
    // Place the seed/owner panels immediately. They must never depend on
    // bookshelf, reading progress, or character-feed network responses.
    const support = node('div', 'nl-work-support-stack');
    grid.insertAdjacentElement('afterend', support);
    ['lightSeedArea', 'receivedSeedArea', 'novelPollArea'].forEach((elementId) => {
      const element = document.getElementById(elementId);
      if (element) support.appendChild(element);
    });
    // Preserve the stable novelHeader element for other modules that query it.
    // Its children have been moved into the new grid, so hide the empty shell.
    header.hidden = true;
    header.setAttribute('aria-hidden', 'true');
    document.getElementById('nlContinueReading')?.remove();
    void mountCover(id, cover);
    window.dispatchEvent(new Event('novelight:page-content-ready'));
    void ensureExistingControls(id, actions, secondaryActions)
      .catch((error) => console.warn('work control enhancement unavailable', error));
    void renderCharacters(rows, id, center)
      .catch((error) => console.warn('character cards unavailable', error));
  }

  window.NovelightNovelDetailV2 = Object.freeze({ boot, episodeRows, buildToc });
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => void boot().catch((error) => console.error('novel detail v2 failed', error)), { once: true });
  } else {
    void boot().catch((error) => console.error('novel detail v2 failed', error));
  }
})();