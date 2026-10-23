/* NOVELIGHT 交流広場 Phase 2: no data requests until BOTH site gates are enabled. */
(() => {
  'use strict';
  const flags = window.NOVELIGHT_COMMUNITY_FLAGS || {};
  if (!flags.timeline || !flags.board || !window.supabase) return;

  const byId = id => document.getElementById(id);
  const root = byId('communityBoardInfo');
  if (!root) return;
  const client = supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const CATEGORIES = { stories: '作品の話', writing: '創作相談', general: '雑談' };
  const list = byId('boardThreadList');
  const status = byId('boardStatus');
  const compose = byId('boardComposeForm');
  const detail = byId('boardThreadDetail');
  const panel = byId('boardListPanel');
  const replyList = byId('boardReplyList');
  let selection = null;
  let editing = null;
  let replyTo = null;
  let offset = 0;
  let revision = 0;
  let busy = false;

  const node = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = String(text);
    return el;
  };
  const button = (text, callback, cls = 'board-secondary') => {
    const el = node('button', cls, text);
    el.type = 'button';
    el.addEventListener('click', callback);
    return el;
  };
  const date = raw => {
    const n = new Date(raw);
    return Number.isFinite(n.valueOf())
      ? n.toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
  };
  const say = text => { status.textContent = text; };
  async function rpc(name, payload) {
    const { data, error } = await client.rpc(name, payload);
    if (error) throw error;
    return data;
  }
  async function login() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data?.session?.user) return true;
    location.href = 'login.html?redirect=' + encodeURIComponent('community.html#board');
    return false;
  }
  async function report(name, payload) {
    if (!await login()) return;
    const reason = window.prompt('通報理由を入力してください（500文字以内）');
    if (reason === null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 1 || trimmed.length > 500) {
      say('通報理由は1〜500文字で入力してください。'); return;
    }
    try {
      await rpc(name, { ...payload, p_reason: trimmed });
      say('通報を受け付けました。');
    } catch (_) { say('通報できませんでした。'); }
  }
  function setCompose(row = null) {
    editing = row?.id || null;
    byId('boardComposeHeading').textContent = editing ? 'スレッドを編集' : '新しいスレッド';
    byId('boardComposeSave').textContent = editing ? '変更を保存' : '投稿する';
    byId('boardComposeCategory').value = row?.category || 'stories';
    byId('boardComposeTitle').value = row?.title || '';
    byId('boardComposeBody').value = row?.body || '';
    byId('boardComposeSafety').checked = false;
    compose.hidden = false;
    compose.scrollIntoView({ behavior: 'smooth', block: 'start' });
    byId('boardComposeTitle').focus();
  }
  byId('boardComposeOpen').addEventListener('click', async () => {
    if (busy || !await login()) return;
    setCompose();
  });
  byId('boardComposeCancel').addEventListener('click', () => {
    compose.hidden = true; editing = null;
  });
  compose.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !await login()) return;
    const title = byId('boardComposeTitle').value.trim();
    const body = byId('boardComposeBody').value.trim();
    if (title.length < 4 || title.length > 80 || body.length < 1 || body.length > 2000 || !byId('boardComposeSafety').checked) {
      say('入力内容と全年齢向け確認を見直してください。'); return;
    }
    busy = true;
    byId('boardComposeSave').disabled = true;
    try {
      const id = await rpc('novelight_community_board_save', {
        p_category: byId('boardComposeCategory').value,
        p_title: title, p_body: body,
        p_general_audience_confirmed: true, p_thread_id: editing
      });
      if (!UUID.test(id)) throw new Error('Invalid response');
      compose.hidden = true; editing = null;
      say('スレッドを保存しました。');
      await loadList(true);
      await openThread(id);
    } catch (_) { say('保存できませんでした。投稿制限・ログイン状態・文字数をご確認ください。'); }
    finally { busy = false; byId('boardComposeSave').disabled = false; }
  });
  async function loadList(reset = false) {
    if (reset) { offset = 0; list.replaceChildren(); }
    const thisRevision = ++revision;
    const more = byId('boardLoadMore');
    more.disabled = true;
    say('スレッドを読み込み中...');
    try {
      const category = byId('boardCategoryFilter').value || null;
      const rows = await rpc('novelight_community_board_list', {
        p_category: category, p_limit: 15, p_offset: offset
      });
      if (thisRevision !== revision) return;
      if (!Array.isArray(rows)) throw new Error('Invalid list');
      for (const row of rows) {
        if (!UUID.test(row.id)) continue;
        const card = button('', () => { void openThread(row.id); }, 'board-thread-card');
        card.append(
          node('span','board-category',CATEGORIES[row.category] || '掲示板'),
          node('h3','',row.title || ''),
          node('p','',row.excerpt || ''),
          node('span','board-meta',(row.author_name || 'ユーザー') + ' · ' + date(row.created_at) + ' · 返信 ' + (Number(row.reply_count) || 0))
        );
        list.append(card);
      }
      offset += rows.length;
      more.hidden = rows.length < 15 || offset >= 200;
      say(rows.length || offset ? '' : 'まだスレッドはありません。');
    } catch (_) {
      if (thisRevision === revision) say('掲示板を読み込めませんでした。公開設定・通信状態をご確認ください。');
    } finally { if (thisRevision === revision) more.disabled = false; }
  }
  byId('boardCategoryFilter').addEventListener('change', () => { void loadList(true); });
  byId('boardLoadMore').addEventListener('click', () => { void loadList(false); });
  byId('boardBack').addEventListener('click', () => {
    selection = null; detail.hidden = true; panel.hidden = false;
    history.replaceState(null,'','community.html#board');
  });
  function resetReplyTarget() {
    replyTo = null;
    byId('boardReplyLabel').textContent = '返信を書く（500文字以内）';
    byId('boardReplyCancel').hidden = true;
  }
  byId('boardReplyCancel').addEventListener('click', resetReplyTarget);
  async function loadReplies(postKey) {
    replyList.replaceChildren(node('p','community-state','返信を読み込み中...'));
    try {
      const rows = await rpc('novelight_community_comments', {p_post_key:postKey,p_limit:50});
      if (!Array.isArray(rows)) throw new Error('Invalid reply list');
      replyList.replaceChildren();
      for (const row of rows) {
        if (!UUID.test(row.id)) continue;
        const item = node('div','board-reply');
        if (row.parent_comment_id) item.dataset.nested='true';
        item.append(node('span','board-meta',(row.display_name || 'ユーザー')+' · '+date(row.created_at)),node('p','',row.body || ''));
        const acts = node('div','board-actions');
        acts.append(button('返信',()=>{
          replyTo=row.id;
          byId('boardReplyLabel').textContent='返信先：'+(row.display_name || 'ユーザー');
          byId('boardReplyCancel').hidden=false;
          byId('boardReplyBody').focus();
        }));
        if (row.is_mine === true) {
          acts.append(button('編集',async()=>{
            if(!await login())return;
            const next=window.prompt('返信を編集（500文字以内）',row.body || '');
            if(next===null)return;
            if(!next.trim()||next.trim().length>500){say('本文は1〜500文字です。');return;}
            try{await rpc('novelight_community_edit_my_comment',{p_comment_id:row.id,p_body:next.trim()});await loadReplies(postKey);}
            catch(_){say('返信を編集できませんでした。');}
          }));
          acts.append(button('削除',async()=>{
            if(!window.confirm('この返信を削除しますか？'))return;
            try{await rpc('novelight_community_delete_my_comment',{p_comment_id:row.id});await loadReplies(postKey);}
            catch(_){say('返信を削除できませんでした。');}
          }));
        } else {
          acts.append(button('通報',()=>{void report('novelight_community_report_comment',{p_comment_id:row.id});}));
        }
        item.append(acts);
        replyList.append(item);
      }
      if (!rows.length) replyList.append(node('p','community-state','まだ返信はありません。'));
    } catch (_) {
      replyList.replaceChildren(node('p','community-state','返信を取得できませんでした。'));
    }
  }
  async function openThread(id) {
    if (!UUID.test(id)) return;
    say('スレッドを読み込み中...');
    try {
      const row = await rpc('novelight_community_board_detail',{p_thread_id:id});
      if (!row || row.id !== id) {say('スレッドは公開されていません。');return;}
      selection = row;
      panel.hidden = true;
      detail.hidden = false;
      byId('boardDetailTitle').textContent = row.title;
      byId('boardDetailBody').textContent = row.body;
      byId('boardDetailMeta').textContent = (CATEGORIES[row.category] || '掲示板')+' · '+(row.author_name || 'ユーザー')+' · '+date(row.created_at);
      const actions = byId('boardDetailActions');
      actions.replaceChildren();
      if (row.is_mine === true) {
        actions.append(button('編集する',()=>{setCompose(row);}));
        actions.append(button('削除する',async()=>{
          if (!window.confirm('このスレッドと公開中の返信を非表示にしますか？')) return;
          try {
            await rpc('novelight_community_board_delete',{p_thread_id:row.id});
            selection=null;detail.hidden=true;panel.hidden=false;
            history.replaceState(null,'','community.html#board');
            await loadList(true);say('スレッドを削除しました。');
          } catch (_) {say('削除できませんでした。');}
        }));
      } else {
        actions.append(button('通報する',()=>{void report('novelight_community_report',{p_post_key:row.post_key});}));
      }
      resetReplyTarget();
      await loadReplies(row.post_key);
      say('');
      history.replaceState(null,'','community.html#board-thread-' + encodeURIComponent(row.id));
    } catch (_) {say('スレッドを取得できませんでした。');}
  }
  byId('boardReplyForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy || !selection || !await login())return;
    const body=byId('boardReplyBody').value.trim();
    if (!body || body.length>500) {say('返信は1〜500文字で入力してください。');return;}
    busy=true;byId('boardReplySend').disabled=true;
    try {
      await rpc('novelight_community_post_comment',{
        p_post_key:selection.post_key,p_body:body,p_parent_comment_id:replyTo
      });
      byId('boardReplyBody').value='';resetReplyTarget();
      await loadReplies(selection.post_key);
      say('返信を投稿しました。');
    } catch (_) {say('返信できませんでした。時間をおいてお試しください。');}
    finally {busy=false;byId('boardReplySend').disabled=false;}
  });
  let firstBoardOpen = false;
  function activateBoard() {
    if (firstBoardOpen) return;
    firstBoardOpen = true;
    void loadList(true);
  }
  byId('communityBoardTab').addEventListener('click', activateBoard);
  const deepLink = window.NOVELIGHT_BOARD_INITIAL_THREAD;
  if (UUID.test(deepLink || '')) {
    firstBoardOpen = true;
    void (async () => {
      await loadList(true);
      await openThread(deepLink);
    })();
  } else if (location.hash === '#board') activateBoard();
})();