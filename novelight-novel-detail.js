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
      body.nl-work-detail-v2{background:#f6f3ed;color:#2f2923}
      body.nl-work-detail-v2 main{max-width:1380px!important;padding:34px 24px 76px!important}
      .nl-work-detail-grid{display:grid;grid-template-columns:minmax(190px,250px) minmax(0,720px) minmax(240px,320px);gap:24px;align-items:start;margin:0 auto 18px}
      .nl-work-detail-left{position:sticky;top:20px;display:grid;gap:14px;min-width:0}
      .nl-work-detail-cover{width:100%;aspect-ratio:2/3;border-radius:13px;overflow:hidden;background:linear-gradient(145deg,#f0eadf,#ddd2c1);border:1px solid #d8ccbb;box-shadow:0 18px 36px rgba(52,39,26,.14);display:grid;place-items:center}
      .nl-work-detail-cover img{width:100%;height:100%;display:block;object-fit:cover}
      .nl-work-detail-cover-placeholder{display:grid;place-items:center;width:100%;height:100%;padding:28px;text-align:center;color:#776858;font-weight:900;letter-spacing:.12em;font-size:13px}
      .nl-work-detail-left .tags{display:flex;gap:6px;flex-wrap:wrap;margin:0}
      .nl-work-detail-left .tag,.nl-work-detail-left .novelight-work-tag{font-size:10px}
      .nl-work-detail-bookmeta{display:grid;gap:6px;padding:13px 14px;border:1px solid #e2d9cd;border-radius:12px;background:#fffdfa;color:#706456;font-size:12px;line-height:1.5}
      .nl-work-detail-bookmeta strong{color:#3d3126}
      .nl-work-detail-center{min-width:0;display:grid;gap:18px}
      .nl-work-detail-main{padding:30px;background:#fffdfa;border:1px solid #e5ddd1;border-radius:16px;box-shadow:0 10px 32px rgba(55,43,31,.04)}
      .nl-work-detail-main .title{font-size:clamp(30px,3vw,44px);line-height:1.35;margin-bottom:12px;letter-spacing:.01em}
      .nl-work-detail-main .author{margin-bottom:17px;color:#746b62}
      .nl-work-detail-main .meta{width:100%;margin:0 0 20px;padding:12px 0;border-top:1px solid #eee7dc;border-bottom:1px solid #eee7dc;color:#7d746a}
      .nl-work-detail-synopsis{margin-top:22px;padding-top:22px;border-top:1px solid #eee7dc}
      .nl-work-detail-kicker{margin-bottom:8px;color:#9a7b4e;font-size:11px;font-weight:900;letter-spacing:.14em}
      .nl-work-detail-synopsis h2,.nl-work-character-section h2{font-size:20px;margin:0 0 11px}
      .nl-work-detail-synopsis .description{margin:0;color:#4f4942;line-height:2;white-space:pre-wrap}
      .nl-work-detail-actions{display:flex;align-items:stretch;gap:8px;flex-wrap:wrap;margin-top:20px}
      .nl-work-detail-actions .favorite,.nl-work-detail-actions .nl-book-control-button,.nl-work-detail-actions .novelight-curation-add-button,.nl-work-share-button,.nl-work-toc-mobile-button,.nl-work-report-button{min-height:42px;padding:9px 12px;border:1px solid #d7ccbd;border-radius:10px;background:#fff;color:#4b3b2c;font:inherit;font-size:12px;font-weight:900;cursor:pointer}
      .nl-work-detail-actions .nl-book-control{display:contents!important}
      .nl-work-detail-actions .nl-book-panel,.nl-work-detail-actions .novelight-curation-add-panel{flex:1 0 100%;order:30;width:100%}
      .nl-work-read-action{order:-20;display:flex;align-items:center;justify-content:space-between;gap:14px;flex:1 1 100%;min-height:56px;padding:13px 17px;border-radius:11px;background:#3b2a1d;color:#fff!important;text-decoration:none!important;font-size:16px;font-weight:900}
      .nl-work-read-action small{display:block;margin-top:3px;color:#dfd1c1;font-size:10px;font-weight:700}
      .nl-work-share-x{text-decoration:none!important;display:inline-flex;align-items:center;justify-content:center}
      .nl-work-detail-toc{position:sticky;top:20px;max-height:calc(100vh - 40px);overflow:auto;padding:18px;border:1px solid #e2d9cd;border-radius:16px;background:#fffdfa;box-shadow:0 10px 30px rgba(52,42,31,.05)}
      .nl-work-detail-toc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
      .nl-work-detail-toc h2{font-size:17px;margin:0}.nl-work-detail-toc-count{color:#8a7a69;font-size:11px}
      .nl-work-toc-list{display:grid;gap:4px}.nl-work-toc-chapter{margin:12px 0 3px;padding:8px 9px;border-left:3px solid #aa8a5b;background:#f8f2e8;color:#574535;font-size:12px;font-weight:900}
      .nl-work-toc-link{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px;align-items:start;padding:8px 9px;border-radius:8px;color:#4c4239!important;text-decoration:none!important;font-size:12px;line-height:1.45}
      .nl-work-toc-link:hover{background:#f7f1e8}.nl-work-toc-link.is-read{color:#8a8178!important}.nl-work-toc-link.is-current{background:#f1e6d4;color:#3e2f20!important;font-weight:900}.nl-work-toc-num{white-space:nowrap;color:#9a8061;font-size:10px;padding-top:2px}
      body.nl-work-detail-v2 #episodesPanel{display:none!important}
      .nl-work-character-section{padding:24px;background:#fffdfa;border:1px solid #e5ddd1;border-radius:16px;box-shadow:0 10px 32px rgba(55,43,31,.04)}
      .nl-work-character-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:15px}.nl-work-character-head p{margin:0;color:#7d746a;font-size:12px;line-height:1.6}
      .nl-work-character-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.nl-work-character-card{display:grid;grid-template-columns:56px minmax(0,1fr);gap:12px;align-items:center;padding:12px;border:1px solid #e7dfd4;border-radius:12px;background:#fff}.nl-work-character-image,.nl-work-character-fallback{width:56px;height:56px;border-radius:10px;object-fit:cover;background:#efe9df;display:grid;place-items:center;color:#7a6855;font-weight:900;font-size:19px}.nl-work-character-copy strong{display:block;margin-bottom:4px;font-size:14px}.nl-work-character-copy p{margin:0;color:#786f66;font-size:11px;line-height:1.55}.nl-work-character-more{margin-top:12px;border:0;background:transparent;color:#70542d;font:inherit;font-size:12px;font-weight:900;cursor:pointer;padding:4px 0}.nl-work-character-card.is-extra{display:none}.nl-work-character-grid.is-expanded .nl-work-character-card.is-extra{display:grid}
      .nl-work-support-stack{max-width:1380px;margin:0 auto}.nl-work-support-stack #lightSeedArea,.nl-work-support-stack #receivedSeedArea,.nl-work-support-stack #novelPollArea{margin-bottom:18px}.nl-work-support-stack #lightSeedArea{padding:18px 20px;background:#fffdfa;border-color:#e4dac9}.nl-work-support-stack .seed-types{gap:7px;margin-top:12px}.nl-work-support-stack .seed-choice{min-height:60px;padding:9px}.nl-work-support-stack .received-seed-panel{padding:20px}
      .nl-work-toc-mobile-button{display:none}.nl-work-toc-dialog{border:0;padding:0;background:transparent;max-width:none;max-height:none;width:100%;height:100%;margin:0}.nl-work-toc-dialog::backdrop{background:rgba(30,24,18,.48)}.nl-work-toc-sheet{position:absolute;left:0;right:0;bottom:0;max-height:82vh;overflow:auto;border-radius:20px 20px 0 0;background:#fffdfa;padding:18px 16px 28px;box-shadow:0 -18px 46px rgba(28,22,17,.18)}.nl-work-toc-sheet-head{position:sticky;top:-18px;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-18px -16px 10px;padding:17px 16px 12px;background:#fffdfa;border-bottom:1px solid #eee6db}.nl-work-toc-sheet-head h2{font-size:18px;margin:0}.nl-work-toc-close{border:1px solid #d8cec1;border-radius:999px;background:#fff;width:36px;height:36px;font-size:20px;cursor:pointer}
      @media(max-width:1050px){body.nl-work-detail-v2 main{max-width:980px!important}.nl-work-detail-grid{grid-template-columns:210px minmax(0,1fr)}.nl-work-detail-toc{grid-column:1/-1;position:static;max-height:none}.nl-work-toc-list{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:14px}.nl-work-toc-chapter{grid-column:1/-1}}
      @media(max-width:760px){body.nl-work-detail-v2 main{padding:22px 14px 60px!important}.nl-work-detail-grid{grid-template-columns:1fr;gap:16px}.nl-work-detail-left{position:static;display:grid;place-items:center}.nl-work-detail-cover{width:min(64vw,230px)}.nl-work-detail-left .tags,.nl-work-detail-bookmeta{width:100%}.nl-work-detail-main{padding:22px 18px}.nl-work-detail-toc{display:none}.nl-work-toc-mobile-button{display:inline-flex;align-items:center;justify-content:center}.nl-work-character-grid{grid-template-columns:1fr}.nl-work-character-head{align-items:flex-start;flex-direction:column;gap:4px}.nl-work-detail-actions{display:grid;grid-template-columns:1fr 1fr}.nl-work-read-action{grid-column:1/-1}.nl-work-detail-actions .nl-book-panel,.nl-work-detail-actions .novelight-curation-add-panel{grid-column:1/-1}}
      @media(max-width:430px){.nl-work-detail-actions{grid-template-columns:1fr}.nl-work-detail-actions>*{width:100%}}
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
      return { id: url.searchParams.get('id'), number: Number(match[1]), title: link.textContent.trim(), href: link.href, element: episode };
    }).filter(Boolean);
  }

  function outlineItems(rows) {
    const rowByElement = new Map(rows.map((row) => [row.element, row]));
    const items = [];
    document.querySelectorAll('#episodeList > .chapter-heading, #episodeList > .episode').forEach((node) => {
      if (node.classList.contains('chapter-heading')) items.push({ type: 'chapter', title: node.textContent.trim() });
      else if (rowByElement.has(node)) items.push({ type: 'episode', row: rowByElement.get(node) });
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

  function buildToc(items, id) {
    const wrap = document.createElement('div');
    wrap.className = 'nl-work-toc-list';
    const progress = readProgress(id);
    const currentNumber = Number(progress?.episodeNumber) || 0;
    const currentId = progress?.episodeId ? String(progress.episodeId) : '';
    for (const item of items) {
      if (item.type === 'chapter') {
        const chapter = document.createElement('div'); chapter.className = 'nl-work-toc-chapter'; chapter.textContent = item.title; wrap.appendChild(chapter); continue;
      }
      const row = item.row;
      const link = document.createElement('a'); link.className = 'nl-work-toc-link'; link.href = row.href;
      if (currentNumber && row.number <= currentNumber) link.classList.add('is-read');
      if (currentId && String(row.id) === currentId) link.classList.add('is-current');
      const num = document.createElement('span'); num.className = 'nl-work-toc-num'; num.textContent = `第${row.number}話`;
      const title = document.createElement('span'); title.textContent = row.title || `第${row.number}話`;
      link.append(num, title); wrap.appendChild(link);
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
    } catch { return source; }
  }

  async function coverUrl(id) {
    try {
      const direct = await client.from('novels').select('thumbnail_url').eq('id', id).maybeSingle();
      if (!direct.error && direct.data?.thumbnail_url) return direct.data.thumbnail_url;
      let composition = await client.rpc('novelight_thumbnail_compositions_v3', { p_novel_ids: [String(id)] });
      if (['42883','42P01','42703'].includes(String(composition.error?.code || ''))) composition = await client.rpc('novelight_thumbnail_compositions_v2', { p_novel_ids: [String(id)] });
      if (composition.error) return '';
      return (Array.isArray(composition.data) ? composition.data[0] : null)?.render_url || '';
    } catch (error) { console.warn('work cover unavailable', error); return ''; }
  }

  async function mountCover(id, cover) {
    const url = await coverUrl(id);
    if (!url) return;
    const image = document.createElement('img'); image.src = optimizedImageUrl(url); image.alt = ''; image.decoding = 'async'; image.loading = 'eager'; image.fetchPriority = 'high'; cover.replaceChildren(image);
  }

  function installMobileToc(items, id, actions) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'nl-work-toc-mobile-button'; button.textContent = '目次を見る';
    const dialog = document.createElement('dialog'); dialog.id = 'nlWorkTocDialog'; dialog.className = 'nl-work-toc-dialog';
    const sheet = document.createElement('section'); sheet.className = 'nl-work-toc-sheet';
    const head = document.createElement('div'); head.className = 'nl-work-toc-sheet-head';
    const title = document.createElement('h2'); title.textContent = '目次';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'nl-work-toc-close'; close.setAttribute('aria-label','目次を閉じる'); close.textContent = '×';
    head.append(title, close); sheet.append(head, buildToc(items, id)); dialog.appendChild(sheet); document.body.appendChild(dialog);
    button.addEventListener('click', () => dialog.showModal()); close.addEventListener('click', () => dialog.close()); dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }); dialog.addEventListener('close', () => button.focus()); actions.appendChild(button);
  }

  function addShareControls(actions) {
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'nl-work-share-button'; copy.textContent = 'URLをコピー';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(window.location.href); }
      catch { const input=document.createElement('textarea'); input.value=window.location.href; input.style.position='fixed'; input.style.opacity='0'; document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove(); }
      copy.textContent='コピーしました'; window.setTimeout(()=>{copy.textContent='URLをコピー';},1600);
    });
    const x=document.createElement('a'); x.className='nl-work-share-button nl-work-share-x'; x.target='_blank'; x.rel='noopener noreferrer'; x.href=`https://x.com/intent/post?text=${encodeURIComponent(document.querySelector('#novelHeader .title')?.textContent?.trim()||'NOVELIGHTの作品')}&url=${encodeURIComponent(window.location.href)}`; x.textContent='Xで共有';
    actions.append(copy,x);
  }

  async function ensureExistingControls(id, actions) {
    try {
      if (!document.querySelector('.nl-book-control')) await window.NovelightBookshelf?.installNovelControl?.(client);
    } catch (error) { console.warn('bookshelf control unavailable', error); }
    try {
      if (!document.getElementById('curationAddButton') && typeof novel !== 'undefined') await window.NovelightCuration?.mountNovelControl?.(client, novel, typeof session === 'undefined' ? null : session);
    } catch (error) { console.warn('curation control unavailable', error); }
    const move = () => {
      const curation=document.getElementById('curationAddButton'),panel=document.getElementById('curationAddPanel'),book=document.querySelector('.nl-book-control');
      if(curation&&curation.parentElement!==actions)actions.appendChild(curation); if(panel&&panel.parentElement!==actions)actions.appendChild(panel); if(book&&book.parentElement!==actions)actions.appendChild(book);
    };
    move(); const observer=new MutationObserver(move); observer.observe(document.body,{childList:true,subtree:true}); window.setTimeout(()=>observer.disconnect(),12000);
  }

  async function renderCharacters(rows, id, center) {
    if (!rows.length) return;
    const progress=readProgress(id); const boundary=rows.find((row)=>String(row.id)===String(progress?.episodeId))||rows[0];
    try {
      const result=await client.rpc('novelight_character_feed',{p_episode_id:String(boundary.id)}); if(result.error)throw result.error;
      const characters=Array.isArray(result.data)?result.data:[]; if(!characters.length)return;
      const section=document.createElement('section'); section.className='nl-work-character-section';
      const head=document.createElement('div'); head.className='nl-work-character-head'; head.innerHTML='<div><div class="nl-work-detail-kicker">CHARACTERS</div><h2>登場人物</h2></div><p>読んだ範囲までの人物だけを表示します。</p>';
      const grid=document.createElement('div'); grid.className='nl-work-character-grid';
      characters.slice(0,24).forEach((character,index)=>{
        const card=document.createElement('article'); card.className=`nl-work-character-card${index>=6?' is-extra':''}`;
        if(character.image_url){const image=document.createElement('img'); image.className='nl-work-character-image'; image.src=String(character.image_url); image.alt=`${character.name||'登場人物'}の画像`; image.loading='lazy'; image.decoding='async'; image.referrerPolicy='no-referrer'; card.appendChild(image);}else{const fallback=document.createElement('div'); fallback.className='nl-work-character-fallback'; fallback.setAttribute('aria-hidden','true'); fallback.textContent=String(character.name||'人').slice(0,1); card.appendChild(fallback);}
        const copy=document.createElement('div'); copy.className='nl-work-character-copy'; const name=document.createElement('strong'); name.textContent=character.name||'登場人物'; const description=document.createElement('p'); description.textContent=character.description||(Number(character.latest_episode_number)?`第${Number(character.latest_episode_number)}話までに登場`:'登場人物'); copy.append(name,description); card.appendChild(copy); grid.appendChild(card);
      });
      section.append(head,grid);
      if(characters.length>6){const more=document.createElement('button'); more.type='button'; more.className='nl-work-character-more'; more.textContent='登場人物をもっと見る →'; more.addEventListener('click',()=>{const expanded=grid.classList.toggle('is-expanded');more.textContent=expanded?'登場人物を閉じる ↑':'登場人物をもっと見る →';}); section.appendChild(more);}
      center.appendChild(section);
    } catch(error){console.warn('character cards unavailable',error);}
  }

  async function boot() {
    if (!/(^|\/)novel\.html$/u.test(window.location.pathname) || document.body.classList.contains('nl-work-detail-v2')) return;
    const id=currentNovelId(); if(!id)return;
    await waitFor('#favoriteButton');
    await waitFor('#episodeList a[href*="episode.html?id="]',{timeout:15000}).catch(()=>null);
    const header=document.getElementById('novelHeader'),favorite=document.getElementById('favoriteButton'),title=header?.querySelector('.title'),tags=header?.querySelector('.tags'),author=header?.querySelector('.author'),description=header?.querySelector('.description'),meta=header?.querySelector('.meta');
    if(!header||!favorite||!title||!tags||!author||!description||!meta)return;
    installStyles(); document.body.classList.add('nl-work-detail-v2');
    const rows=episodeRows(),items=outlineItems(rows); await syncProgress(id); const target=continueTarget(rows,readProgress(id));
    const grid=document.createElement('div'); grid.className='nl-work-detail-grid'; header.insertAdjacentElement('beforebegin',grid);
    const left=document.createElement('aside'); left.className='nl-work-detail-left'; const cover=document.createElement('div'); cover.className='nl-work-detail-cover'; cover.innerHTML='<div class="nl-work-detail-cover-placeholder">NOVELIGHT</div>'; left.append(cover,tags);
    const metaBox=document.createElement('div'); metaBox.className='nl-work-detail-bookmeta'; metaBox.innerHTML=`<strong>${rows.length?'公開中':'作品情報'}</strong><span>${rows.length}話</span><span>作品情報・目次・読書状態を一冊にまとめて表示</span>`; left.appendChild(metaBox);
    const center=document.createElement('div'); center.className='nl-work-detail-center'; const main=document.createElement('section'); main.className='nl-work-detail-main'; const actions=document.createElement('div'); actions.className='nl-work-detail-actions';
    main.append(title,author,meta);
    if(target){const read=document.createElement('a'); read.className='nl-work-read-action'; read.href=target.row.href; read.innerHTML=`<span>${target.label}<small>${target.unread>0?`未読 ${target.unread}話`:'最新話まで読了'}</small></span><span aria-hidden="true">→</span>`; actions.appendChild(read);}
    actions.appendChild(favorite); addShareControls(actions); installMobileToc(items,id,actions);
    const report=document.getElementById('readerReportOpen'); if(report){report.classList.remove('action','report');report.classList.add('nl-work-report-button');report.textContent='通報';actions.appendChild(report);}
    main.appendChild(actions); const synopsis=document.createElement('div'); synopsis.className='nl-work-detail-synopsis'; synopsis.innerHTML='<div class="nl-work-detail-kicker">STORY</div><h2>あらすじ</h2>'; synopsis.appendChild(description); main.appendChild(synopsis); center.appendChild(main);
    const toc=document.createElement('aside'); toc.className='nl-work-detail-toc'; toc.setAttribute('aria-label','目次'); const tocHead=document.createElement('div'); tocHead.className='nl-work-detail-toc-head'; tocHead.innerHTML=`<h2>目次</h2><span class="nl-work-detail-toc-count">${rows.length}話</span>`; toc.append(tocHead,buildToc(items,id));
    grid.append(left,center,toc); header.remove(); document.getElementById('nlContinueReading')?.remove();
    await ensureExistingControls(id,actions); await renderCharacters(rows,id,center); void mountCover(id,cover);
    const support=document.createElement('div'); support.className='nl-work-support-stack'; grid.insertAdjacentElement('afterend',support); ['lightSeedArea','receivedSeedArea','novelPollArea'].forEach((elementId)=>{const node=document.getElementById(elementId);if(node)support.appendChild(node);});
  }

  window.NovelightNovelDetailV2=Object.freeze({boot,episodeRows,buildToc});
  if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',()=>void boot().catch((error)=>console.error('novel detail v2 failed',error)),{once:true}); else void boot().catch((error)=>console.error('novel detail v2 failed',error));
})();
