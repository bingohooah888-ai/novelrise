(() => {
  'use strict';

  const STYLE_ID = 'novelight-today-book-style';
  const ROOT_ID = 'novelightTodayBook';
  const SWIPE_THRESHOLD = 72;
  const SWIPE_RATIO = 1.35;

  function pageSlug() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    return file.replace(/\.html$/u, '').toLowerCase();
  }

  function makeClient() {
    if (!window.supabase?.createClient) return null;
    return window.supabase.createClient(
      'https://fiepaguycecrredwrcwx.supabase.co',
      'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
    );
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .nl-today-book{position:fixed;inset:0;z-index:1200;overflow:auto;background:rgba(2,8,18,.82);padding:34px 18px}
      .nl-today-book[hidden]{display:none}.nl-today-card{width:min(1080px,100%);margin:0 auto;background:#071221;color:#f7f3e8;border:1px solid rgba(214,164,71,.45);border-radius:22px;box-shadow:0 26px 80px rgba(0,0,0,.42);overflow:visible}
      .nl-today-kicker{padding:18px 24px 0;color:#d6a447;font-size:12px;font-weight:900;letter-spacing:.18em}
      .nl-today-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:34px;padding:22px 24px 28px}
      .nl-today-cover-wrap{display:flex;justify-content:center;margin-bottom:22px}.nl-today-cover{display:block;width:min(360px,78%);aspect-ratio:2/3;object-fit:cover;border-radius:13px;border:1px solid rgba(214,164,71,.32);background:#101d2d}
      .nl-today-cover-fallback{width:min(360px,78%);aspect-ratio:2/3;border-radius:13px;border:1px solid rgba(214,164,71,.32);background:linear-gradient(160deg,#111d2e,#08111f);display:grid;place-items:center;text-align:center;padding:24px;color:#d6a447;font-weight:900;letter-spacing:.12em}
      .nl-today-copy h2{font-size:17px;margin:0 0 10px;color:#d6a447}.nl-today-synopsis{white-space:pre-wrap;line-height:1.95;color:#ece7dd;font-size:15px}.nl-today-meta{display:grid;gap:6px;margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,.1);color:#aeb7c4;font-size:13px}
      .nl-today-actions{position:sticky;top:24px;align-self:start;padding:22px;border:1px solid rgba(214,164,71,.24);border-radius:16px;background:rgba(9,21,37,.94)}
      .nl-today-title{font-size:30px;line-height:1.45;margin:0 0 22px}.nl-today-buttons{display:grid;gap:11px}.nl-today-button{width:100%;min-height:48px;border-radius:11px;border:1px solid rgba(214,164,71,.55);font:inherit;font-weight:900;cursor:pointer}
      .nl-today-read{background:#d6a447;color:#071221}.nl-today-later{background:#111f31;color:#f7f3e8}.nl-today-skip{background:transparent;color:#8f99a8;border-color:transparent;font-weight:700}
      .nl-today-button:disabled{opacity:.55;cursor:wait}.nl-today-note{margin:14px 0 0;color:#8f99a8;font-size:11px;line-height:1.6}
      .nl-today-swipe-hint{display:none;position:fixed;left:50%;bottom:92px;z-index:1202;transform:translateX(-50%);padding:10px 14px;border-radius:999px;background:#d6a447;color:#071221;font-weight:900;box-shadow:0 8px 24px rgba(0,0,0,.28)}
      .nl-today-swipe-hint.show{display:block}.nl-today-toast{position:fixed;left:50%;bottom:24px;z-index:1300;transform:translateX(-50%);padding:11px 16px;border-radius:999px;background:#f7f3e8;color:#071221;font-weight:900;box-shadow:0 10px 30px rgba(0,0,0,.3)}
      @media(max-width:760px){
        .nl-today-book{padding:12px 0 92px}.nl-today-card{border-radius:0;min-height:100%}.nl-today-kicker{padding:18px 18px 0}
        .nl-today-grid{grid-template-columns:1fr;gap:18px;padding:18px}.nl-today-main{display:contents}.nl-today-cover-wrap{order:1}.nl-today-actions{position:static;display:contents}.nl-today-title{order:2;font-size:25px;margin:0}.nl-today-copy{order:3}
        .nl-today-buttons{position:fixed;left:0;right:0;bottom:0;z-index:1201;grid-template-columns:1fr 1fr auto;gap:7px;padding:9px 10px max(9px,env(safe-area-inset-bottom));background:rgba(7,18,33,.98);border-top:1px solid rgba(214,164,71,.28)}
        .nl-today-button{min-height:44px}.nl-today-skip{width:auto;padding:0 10px}.nl-today-note{display:none}.nl-today-cover,.nl-today-cover-fallback{width:min(330px,84%)}
      }
    `;
    document.head.appendChild(style);
  }

  function toast(message) {
    document.querySelector('.nl-today-toast')?.remove();
    const node = document.createElement('div');
    node.className = 'nl-today-toast';
    node.setAttribute('role', 'status');
    node.textContent = message;
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 2400);
  }

  async function recordAction(client, novelId, action) {
    try {
      const result = await client.rpc('novelight_today_book_record_action_v1', {
        p_novel_id: Number(novelId),
        p_action: action
      });
      if (result.error) throw result.error;
    } catch (error) {
      console.warn('Today book action record failed', error);
    }
  }

  async function addReadLater(client, row, source) {
    const auth = await client.auth.getSession();
    if (auth.error) throw auth.error;
    const session = auth.data?.session;
    if (!session) throw new Error('ログインが必要です。');
    if (!window.NovelightBookshelf) throw new Error('本棚機能を読み込めませんでした。');

    const loaded = await window.NovelightBookshelf.loadEntry(client, session.user.id, row.novel_id);
    if (!loaded.available) throw new Error('本棚機能は準備中です。');
    if (loaded.entry?.reading_state !== 'want_to_read') {
      await window.NovelightBookshelf.saveEntry(client, session.user.id, row.novel_id, {
        readingState: 'want_to_read',
        listName: loaded.entry?.list_name || '',
        memo: loaded.entry?.memo || ''
      });
    }
    await recordAction(client, row.novel_id, source === 'swipe' ? 'swipe_read_later' : 'read_later');
  }

  function createCover(row) {
    const wrap = document.createElement('div');
    wrap.className = 'nl-today-cover-wrap';
    if (String(row.thumbnail_url || '').startsWith('https://')) {
      const image = document.createElement('img');
      image.className = 'nl-today-cover';
      image.src = row.thumbnail_url;
      image.alt = `${row.title}の作品画像`;
      image.decoding = 'async';
      wrap.appendChild(image);
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'nl-today-cover-fallback';
      fallback.textContent = 'NOVELIGHT';
      fallback.setAttribute('aria-label', `${row.title}のNOVELIGHTカバー`);
      wrap.appendChild(fallback);
    }
    return wrap;
  }

  function render(client, row) {
    installStyles();
    const root = document.createElement('section');
    root.id = ROOT_ID;
    root.className = 'nl-today-book';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'nlTodayTitle');

    const card = document.createElement('div');
    card.className = 'nl-today-card';
    const kicker = document.createElement('div');
    kicker.className = 'nl-today-kicker';
    kicker.textContent = '今日の一冊';

    const grid = document.createElement('div');
    grid.className = 'nl-today-grid';
    const main = document.createElement('div');
    main.className = 'nl-today-main';
    main.appendChild(createCover(row));

    const copy = document.createElement('div');
    copy.className = 'nl-today-copy';
    const synopsisHeading = document.createElement('h2');
    synopsisHeading.textContent = 'あらすじ';
    const synopsis = document.createElement('div');
    synopsis.className = 'nl-today-synopsis';
    synopsis.textContent = row.description || 'あらすじはまだ登録されていません。';
    const meta = document.createElement('div');
    meta.className = 'nl-today-meta';
    const author = document.createElement('span');
    author.textContent = `作者：${row.author_name || '未設定'}`;
    const genre = document.createElement('span');
    genre.textContent = `ジャンル：${row.genre || '未設定'}`;
    meta.append(author, genre);
    copy.append(synopsisHeading, synopsis, meta);
    main.appendChild(copy);

    const actions = document.createElement('aside');
    actions.className = 'nl-today-actions';
    const title = document.createElement('h1');
    title.id = 'nlTodayTitle';
    title.className = 'nl-today-title';
    title.textContent = row.title || '無題';
    const buttons = document.createElement('div');
    buttons.className = 'nl-today-buttons';
    const read = document.createElement('button');
    read.type = 'button';
    read.className = 'nl-today-button nl-today-read';
    read.textContent = '今すぐ読む';
    const later = document.createElement('button');
    later.type = 'button';
    later.className = 'nl-today-button nl-today-later';
    later.textContent = '後で読む';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'nl-today-button nl-today-skip';
    skip.textContent = '今日は見送る';
    buttons.append(read, later, skip);
    const note = document.createElement('p');
    note.className = 'nl-today-note';
    note.textContent = '一度本文を開いた作品は、今後「今日の一冊」の候補から外れます。';
    actions.append(title, buttons, note);
    grid.append(main, actions);
    card.append(kicker, grid);
    root.appendChild(card);

    const swipeHint = document.createElement('div');
    swipeHint.className = 'nl-today-swipe-hint';
    swipeHint.textContent = '後で読むに追加';
    root.appendChild(swipeHint);

    let busy = false;
    const disable = (value) => {
      busy = value;
      read.disabled = value;
      later.disabled = value;
      skip.disabled = value;
    };
    const close = () => root.remove();

    read.addEventListener('click', async () => {
      if (busy) return;
      disable(true);
      await recordAction(client, row.novel_id, 'read_now');
      await recordAction(client, row.novel_id, 'first_episode_arrival');
      window.location.href = `episode.html?id=${encodeURIComponent(row.first_episode_id)}&source=today_book`;
    });

    later.addEventListener('click', async () => {
      if (busy) return;
      disable(true);
      try {
        await addReadLater(client, row, 'button');
        close();
        toast('後で読むに追加しました');
      } catch (error) {
        console.error('Today book read-later failed', error);
        toast(error?.message || '後で読むに追加できませんでした');
        disable(false);
      }
    });

    skip.addEventListener('click', async () => {
      if (busy) return;
      disable(true);
      await recordAction(client, row.novel_id, 'skip');
      close();
    });

    let pointer = null;
    card.addEventListener('pointerdown', (event) => {
      if (!window.matchMedia('(max-width:760px)').matches || busy) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }, { passive: true });
    card.addEventListener('pointermove', (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      swipeHint.classList.toggle('show', dx >= SWIPE_THRESHOLD && Math.abs(dx) >= Math.abs(dy) * SWIPE_RATIO);
    }, { passive: true });
    const finishSwipe = async (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer = null;
      swipeHint.classList.remove('show');
      if (busy || dx < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
      disable(true);
      try {
        await addReadLater(client, row, 'swipe');
        close();
        toast('後で読むに追加しました');
      } catch (error) {
        console.error('Today book swipe read-later failed', error);
        toast(error?.message || '後で読むに追加できませんでした');
        disable(false);
      }
    };
    card.addEventListener('pointerup', finishSwipe, { passive: true });
    card.addEventListener('pointercancel', () => {
      pointer = null;
      swipeHint.classList.remove('show');
    }, { passive: true });

    document.body.appendChild(root);
    read.focus({ preventScroll: true });
  }

  async function boot() {
    if (pageSlug() !== 'index' || document.getElementById(ROOT_ID)) return;
    const client = makeClient();
    if (!client) return;
    const auth = await client.auth.getSession();
    if (auth.error || !auth.data?.session) return;
    const result = await client.rpc('novelight_today_book_v1');
    if (result.error) {
      console.warn('Today book unavailable', result.error);
      return;
    }
    const row = Array.isArray(result.data) ? result.data[0] : null;
    if (!row) return;
    render(client, row);
  }

  void boot().catch((error) => console.error('Today book failed', error));
})();
