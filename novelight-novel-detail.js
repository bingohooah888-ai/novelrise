(function () {
  'use strict';

  const STYLE_ID = 'novelight-novel-detail-v2-style';
  const SCRIPT_ID = 'novelight-novel-detail-v2';

  function novelId() {
    return new URLSearchParams(window.location.search).get('id');
  }

  function waitFor(selector, { timeout = 0, root = document } = {}) {
    const found = root.querySelector(selector);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const node = root.querySelector(selector);
        if (!node) return;
        observer.disconnect();
        if (timer) clearTimeout(timer);
        resolve(node);
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

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      body.nl-work-detail-v2 main{max-width:1380px!important;padding-left:24px!important;padding-right:24px!important}
      .nl-work-detail-grid{display:grid;grid-template-columns:minmax(190px,250px) minmax(0,720px) minmax(240px,320px);gap:24px;align-items:start;margin:0 auto 20px}
      .nl-work-detail-left{position:sticky;top:20px;display:grid;gap:15px;min-width:0}
      .nl-work-detail-left #nlNovelDetailCover{width:100%;margin:0;aspect-ratio:2/3}
      .nl-work-detail-left .tags{display:flex;gap:6px;flex-wrap:wrap;margin:0}
      .nl-work-detail-left .tag,.nl-work-detail-left .novelight-work-tag{font-size:10px}
      .nl-work-detail-bookmeta{display:grid;gap:7px;padding:13px 14px;border:1px solid #e2d9cd;border-radius:12px;background:#fffdfa;color:#6f6255;font-size:12px;line-height:1.5}
      .nl-work-detail-bookmeta strong{color:#3f3327;font-size:12px}
      .nl-work-detail-center{min-width:0;display:grid;gap:18px}
      body.nl-work-detail-v2 #novelHeader.nl-novel-detail{margin:0}
      body.nl-work-detail-v2 #novelHeader .nl-novel-hero{display:block;padding:28px 30px 20px}
      body.nl-work-detail-v2 #novelHeader .nl-novel-main{display:block}
      body.nl-work-detail-v2 #novelHeader .nl-novel-main>.tags{display:none}
      body.nl-work-detail-v2 #novelHeader .nl-novel-description-section{padding:24px 30px 30px}
      body.nl-work-detail-v2 #novelHeader .nl-novel-main .title{font-size:clamp(30px,3vw,44px);margin-bottom:12px}
      .nl-work-detail-actions{display:flex!important;align-items:stretch!important;gap:8px!important;flex-wrap:wrap!important;margin-top:18px!important}
      .nl-work-detail-actions>*{max-width:100%}
      .nl-work-detail-actions .nl-novel-read-action{order:-20;flex:1 1 100%;min-height:54px;font-size:16px}
      .nl-work-detail-actions .favorite,.nl-work-detail-actions .nl-book-control-button,.nl-work-detail-actions .novelight-curation-add-button,.nl-work-share-button,.nl-work-toc-mobile-button,.nl-work-report-button{min-height:42px;padding:9px 12px;border:1px solid #d7ccbd;border-radius:10px;background:#fff;color:#4b3b2c;font:inherit;font-size:12px;font-weight:900;cursor:pointer}
      .nl-work-detail-actions .nl-book-control{display:contents!important}
      .nl-work-detail-actions .nl-book-panel,.nl-work-detail-actions .novelight-curation-add-panel{flex:1 0 100%;order:30;width:100%}
      .nl-work-share-button:hover,.nl-work-toc-mobile-button:hover{border-color:#a88758;background:#fffaf1}
      .nl-work-share-x{text-decoration:none!important;display:inline-flex;align-items:center;justify-content:center}
      .nl-work-detail-toc{position:sticky;top:20px;max-height:calc(100vh - 40px);overflow:auto;padding:18px;border:1px solid #e2d9cd;border-radius:16px;background:#fffdfa;box-shadow:0 10px 30px rgba(52,42,31,.05)}
      .nl-work-detail-toc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
      .nl-work-detail-toc h2{font-size:17px;margin:0}
      .nl-work-detail-toc-count{color:#8a7a69;font-size:11px}
      .nl-work-toc-list{display:grid;gap:4px}
      .nl-work-toc-chapter{margin:12px 0 3px;padding:8px 9px;border-left:3px solid #aa8a5b;background:#f8f2e8;color:#574535;font-size:12px;font-weight:900}
      .nl-work-toc-link{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px;align-items:start;padding:8px 9px;border-radius:8px;color:#4c4239!important;text-decoration:none!important;font-size:12px;line-height:1.45}
      .nl-work-toc-link:hover{background:#f7f1e8}
      .nl-work-toc-link.is-read{color:#8a8178!important}
      .nl-work-toc-link.is-current{background:#f1e6d4;color:#3e2f20!important;font-weight:900}
      .nl-work-toc-num{white-space:nowrap;color:#9a8061;font-size:10px;padding-top:2px}
      body.nl-work-detail-v2 #episodesPanel{display:none!important}
      .nl-work-character-shell{margin:0!important;padding:24px!important}
      .nl-work-character-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .nl-work-character-card{display:grid;grid-template-columns:56px minmax(0,1fr);gap:12px;align-items:center;padding:12px;border:1px solid #e7dfd4;border-radius:12px;background:#fff}
      .nl-work-character-image,.nl-work-character-fallback{width:56px;height:56px;border-radius:10px;object-fit:cover;background:#efe9df;display:grid;place-items:center;color:#7a6855;font-weight:900;font-size:19px}
      .nl-work-character-copy strong{display:block;margin-bottom:4px;font-size:14px}
      .nl-work-character-copy p{margin:0;color:#786f66;font-size:11px;line-height:1.55}
      .nl-work-character-more{margin-top:12px;border:0;background:transparent;color:#70542d;font:inherit;font-size:12px;font-weight:900;cursor:pointer;padding:4px 0}
      .nl-work-character-card.is-extra{display:none}
      .nl-work-character-grid.is-expanded .nl-work-character-card.is-extra{display:grid}
      .nl-work-seed-stack{max-width:1380px;margin:0 auto}
      .nl-work-toc-mobile-button{display:none}
      .nl-work-toc-dialog{border:0;padding:0;background:transparent;max-width:none;max-height:none;width:100%;height:100%;margin:0}
      .nl-work-toc-dialog::backdrop{background:rgba(30,24,18,.48)}
      .nl-work-toc-sheet{position:absolute;left:0;right:0;bottom:0;max-height:82vh;overflow:auto;border-radius:20px 20px 0 0;background:#fffdfa;padding:18px 16px 28px;box-shadow:0 -18px 46px rgba(28,22,17,.18)}
      .nl-work-toc-sheet-head{position:sticky;top:-18px;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-18px -16px 10px;padding:17px 16px 12px;background:#fffdfa;border-bottom:1px solid #eee6db}
      .nl-work-toc-sheet-head h2{font-size:18px;margin:0}
      .nl-work-toc-close{border:1px solid #d8cec1;border-radius:999px;background:#fff;width:36px;height:36px;font-size:20px;cursor:pointer}
      @media(max-width:1050px){
        body.nl-work-detail-v2 main{max-width:980px!important}
        .nl-work-detail-grid{grid-template-columns:210px minmax(0,1fr)}
        .nl-work-detail-toc{grid-column:1/-1;position:static;max-height:none}
        .nl-work-toc-list{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:14px}
        .nl-work-toc-chapter{grid-column:1/-1}
      }
      @media(max-width:760px){
        body.nl-work-detail-v2 main{padding:22px 14px 60px!important}
        .nl-work-detail-grid{grid-template-columns:1fr;gap:16px}
        .nl-work-detail-left{position:static;display:grid;place-items:center}
        .nl-work-detail-left #nlNovelDetailCover{width:min(64vw,230px)}
        .nl-work-detail-left .tags,.nl-work-detail-bookmeta{width:100%}
        body.nl-work-detail-v2 #novelHeader .nl-novel-hero{padding:22px 18px 16px}
        body.nl-work-detail-v2 #novelHeader .nl-novel-description-section{padding:20px 18px 22px}
        .nl-work-detail-toc{display:none}
        .nl-work-toc-mobile-button{display:inline-flex;align-items:center;justify-content:center}
        .nl-work-character-grid{grid-template-columns:1fr}
        .nl-work-detail-actions{display:grid!important;grid-template-columns:1fr 1fr!important}
        .nl-work-detail-actions .nl-novel-read-action{grid-column:1/-1!important}
        .nl-work-detail-actions .nl-book-panel,.nl-work-detail-actions .novelight-curation-add-panel{grid-column:1/-1!important}
      }
      @media(max-width:430px){
        .nl-work-detail-actions{grid-template-columns:1fr!important}
        .nl-work-detail-actions>*{width:100%}
      }
    `;
    document.head.appendChild(style);
  }

  function episodeRows() {
    return Array.from(document.querySelectorAll('#episodeList .episode'))
      .map((episode) => {
        const link = episode.querySelector('a[href*="episode.html?id="]');
        const numberText = episode.querySelector('.episode-number')?.textContent || '';
        const match = numberText.match(/第\s*(\d+)\s*話/u);
        if (!link || !match) return null;
        const url = new URL(link.href, window.location.href);
        return {
          id: url.searchParams.get('id'),
          number: Number(match[1]),
          title: link.textContent.trim(),
          href: link.href,
          element: episode
        };
      })
      .filter(Boolean);
  }

  function outlineItems(rows) {
    const rowByElement = new Map(rows.map((row) => [row.element, row]));
    const items = [];
    document.querySelectorAll('#episodeList > .chapter-heading, #episodeList > .episode').forEach((node) => {
      if (node.classList.contains('chapter-heading')) {
        items.push({ type: 'chapter', title: node.textContent.trim() });
        return;
      }
      const row = rowByElement.get(node);
      if (row) items.push({ type: 'episode', row });
    });
    return items;
  }

  function readProgress(id) {
    return window.NovelightReadingContinuity?.readProgress?.(id) || null;
  }

  function buildToc(items, id) {
    const wrap = document.createElement('div');
    wrap.className = 'nl-work-toc-list';
    const progress = readProgress(id);
    const currentNumber = Number(progress?.episodeNumber) || 0;
    const currentId = progress?.episodeId ? String(progress.episodeId) : '';

    for (const item of items) {
      if (item.type === 'chapter') {
        const chapter = document.createElement('div');
        chapter.className = 'nl-work-toc-chapter';
        chapter.textContent = item.title;
        wrap.appendChild(chapter);
        continue;
      }
      const row = item.row;
      const link = document.createElement('a');
      link.className = 'nl-work-toc-link';
      if (currentNumber && row.number <= currentNumber) link.classList.add('is-read');
      if (currentId && String(row.id) === currentId) link.classList.add('is-current');
      link.href = row.href;
      const num = document.createElement('span');
      num.className = 'nl-work-toc-num';
      num.textContent = `第${row.number}話`;
      const title = document.createElement('span');
      title.textContent = row.title || `第${row.number}話`;
      link.append(num, title);
      wrap.appendChild(link);
    }
    return wrap;
  }

  function installMobileToc(items, id, actions) {
    if (document.getElementById('nlWorkTocDialog')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nl-work-toc-mobile-button';
    button.textContent = '目次を見る';

    const dialog = document.createElement('dialog');
    dialog.id = 'nlWorkTocDialog';
    dialog.className = 'nl-work-toc-dialog';
    const sheet = document.createElement('section');
    sheet.className = 'nl-work-toc-sheet';
    const head = document.createElement('div');
    head.className = 'nl-work-toc-sheet-head';
    const title = document.createElement('h2');
    title.textContent = '目次';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'nl-work-toc-close';
    close.setAttribute('aria-label', '目次を閉じる');
    close.textContent = '×';
    head.append(title, close);
    sheet.append(head, buildToc(items, id));
    dialog.appendChild(sheet);
    document.body.appendChild(dialog);

    button.addEventListener('click', () => dialog.showModal());
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => button.focus());
    actions.appendChild(button);
  }

  function addShareControls(actions) {
    if (actions.querySelector('.nl-work-share-button')) return;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'nl-work-share-button';
    copy.textContent = 'URLをコピー';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        copy.textContent = 'コピーしました';
      } catch {
        const input = document.createElement('textarea');
        input.value = window.location.href;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
        copy.textContent = 'コピーしました';
      }
      window.setTimeout(() => { copy.textContent = 'URLをコピー'; }, 1600);
    });

    const x = document.createElement('a');
    x.className = 'nl-work-share-button nl-work-share-x';
    x.target = '_blank';
    x.rel = 'noopener noreferrer';
    const title = document.querySelector('#novelHeader .title')?.textContent?.trim() || 'NOVELIGHTの作品';
    x.href = `https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(window.location.href)}`;
    x.textContent = 'Xで共有';
    actions.append(copy, x);
  }

  function relocateDelayedControls(actions) {
    const move = () => {
      const curation = document.getElementById('curationAddButton');
      const curationPanel = document.getElementById('curationAddPanel');
      const book = document.querySelector('.nl-book-control');
      if (curation && curation.parentElement !== actions) actions.appendChild(curation);
      if (curationPanel && curationPanel.parentElement !== actions) actions.appendChild(curationPanel);
      if (book && book.parentElement !== actions) actions.appendChild(book);
    };
    move();
    const observer = new MutationObserver(move);
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 12000);
  }

  function relocateReport(actions) {
    const report = document.getElementById('readerReportOpen');
    if (!report || report.parentElement === actions) return;
    report.classList.add('nl-work-report-button');
    report.classList.remove('report', 'action');
    report.textContent = '通報';
    actions.appendChild(report);
  }

  async function renderCharacters(rows, id, center) {
    const section = document.getElementById('nlNovelCharacters');
    if (!section || !rows.length) return;
    const progress = readProgress(id);
    const boundary = rows.find((row) => String(row.id) === String(progress?.episodeId)) || rows[0];
    try {
      const result = await client.rpc('novelight_character_feed', {
        p_episode_id: String(boundary.id)
      });
      if (result.error) throw result.error;
      const characters = Array.isArray(result.data) ? result.data : [];
      if (!characters.length) {
        section.hidden = true;
        return;
      }
      section.hidden = false;
      section.classList.add('nl-work-character-shell');
      const head = section.querySelector('.nl-novel-character-head');
      if (head) {
        const note = head.querySelector('p');
        if (note) note.textContent = '読んだ範囲までの登場人物だけを表示します。';
      }
      const oldGrid = section.querySelector('.nl-novel-character-grid');
      const grid = document.createElement('div');
      grid.className = 'nl-work-character-grid';
      characters.slice(0, 24).forEach((character, index) => {
        const card = document.createElement('article');
        card.className = `nl-work-character-card${index >= 6 ? ' is-extra' : ''}`;
        if (character.image_url) {
          const image = document.createElement('img');
          image.className = 'nl-work-character-image';
          image.src = String(character.image_url);
          image.alt = `${character.name || '登場人物'}の画像`;
          image.loading = 'lazy';
          image.decoding = 'async';
          image.referrerPolicy = 'no-referrer';
          card.appendChild(image);
        } else {
          const fallback = document.createElement('div');
          fallback.className = 'nl-work-character-fallback';
          fallback.setAttribute('aria-hidden', 'true');
          fallback.textContent = String(character.name || '人').slice(0, 1);
          card.appendChild(fallback);
        }
        const copy = document.createElement('div');
        copy.className = 'nl-work-character-copy';
        const name = document.createElement('strong');
        name.textContent = character.name || '登場人物';
        const description = document.createElement('p');
        description.textContent = character.description || (
          Number(character.latest_episode_number)
            ? `第${Number(character.latest_episode_number)}話までに登場`
            : '登場人物'
        );
        copy.append(name, description);
        card.appendChild(copy);
        grid.appendChild(card);
      });
      oldGrid?.replaceWith(grid);
      section.querySelector('.nl-work-character-more')?.remove();
      if (characters.length > 6) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'nl-work-character-more';
        more.textContent = '登場人物をもっと見る →';
        more.addEventListener('click', () => {
          const expanded = grid.classList.toggle('is-expanded');
          more.textContent = expanded ? '登場人物を閉じる ↑' : '登場人物をもっと見る →';
        });
        section.appendChild(more);
      }
      if (section.parentElement !== center) center.appendChild(section);
    } catch (error) {
      console.warn('character cards unavailable', error);
    }
  }

  function bookMeta(rows) {
    const box = document.createElement('div');
    box.className = 'nl-work-detail-bookmeta';
    const status = document.querySelector('#novelHeader .tag')?.textContent?.trim() || '作品';
    box.innerHTML = `<strong>${status}</strong><span>${rows.length}話</span><span>作品情報・目次・読書状態を一冊にまとめて表示</span>`;
    return box;
  }

  async function boot() {
    if (!/\bnovel\.html$/u.test(window.location.pathname) || document.body.classList.contains('nl-work-detail-v2')) return;
    const id = novelId();
    if (!id) return;
    await waitFor('#favoriteButton');
    await waitFor('#episodeList a[href*="episode.html?id="]', { timeout: 15000 }).catch(() => null);
    const header = document.getElementById('novelHeader');
    const cover = document.getElementById('nlNovelDetailCover');
    const actions = document.getElementById('nlNovelDetailActions');
    const tags = header?.querySelector('.tags');
    if (!header || !cover || !actions || !tags) return;

    installStyles();
    document.body.classList.add('nl-work-detail-v2');
    actions.classList.add('nl-work-detail-actions');

    const rows = episodeRows();
    const items = outlineItems(rows);
    const grid = document.createElement('div');
    grid.className = 'nl-work-detail-grid';
    header.insertAdjacentElement('beforebegin', grid);

    const left = document.createElement('aside');
    left.className = 'nl-work-detail-left';
    left.appendChild(cover);
    left.appendChild(tags);
    left.appendChild(bookMeta(rows));

    const center = document.createElement('div');
    center.className = 'nl-work-detail-center';
    center.appendChild(header);

    const toc = document.createElement('aside');
    toc.className = 'nl-work-detail-toc';
    toc.setAttribute('aria-label', '目次');
    const tocHead = document.createElement('div');
    tocHead.className = 'nl-work-detail-toc-head';
    const tocTitle = document.createElement('h2');
    tocTitle.textContent = '目次';
    const tocCount = document.createElement('span');
    tocCount.className = 'nl-work-detail-toc-count';
    tocCount.textContent = `${rows.length}話`;
    tocHead.append(tocTitle, tocCount);
    toc.append(tocHead, buildToc(items, id));

    grid.append(left, center, toc);
    addShareControls(actions);
    relocateDelayedControls(actions);
    relocateReport(actions);
    installMobileToc(items, id, actions);
    await renderCharacters(rows, id, center);

    const seedStack = document.createElement('div');
    seedStack.className = 'nl-work-seed-stack';
    grid.insertAdjacentElement('afterend', seedStack);
    ['lightSeedArea', 'receivedSeedArea', 'novelPollArea'].forEach((elementId) => {
      const node = document.getElementById(elementId);
      if (node) seedStack.appendChild(node);
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    void boot().catch((error) => console.error('novel detail v2 failed', error));
  }, { once: true });
  if (document.readyState !== 'loading') {
    void boot().catch((error) => console.error('novel detail v2 failed', error));
  }

  window.NovelightNovelDetailV2 = Object.freeze({ boot, buildToc, episodeRows });
  if (!document.getElementById(SCRIPT_ID)) document.documentElement.dataset.novelightNovelDetail = 'v2';
})();
