/* NOVELIGHT 交流広場 Phase 1. No polling, no paid placement, no fabricated activity. */
(function communityPlaza() {
  'use strict';
  const flags = window.NOVELIGHT_COMMUNITY_FLAGS || {};
  if (!flags.timeline || !window.supabase) return;
  const root = document.getElementById('communityHomeFeed') || document.getElementById('communityPageFeed');
  if (!root) return;
  const isHome = root.id === 'communityHomeFeed';
  const panel = document.getElementById('communityHomeSection') || document.getElementById('communityPage');
  if (!panel) return;
  panel.hidden = false;
  const refreshButton = document.getElementById('communityRefresh');
  const filterStatus = document.getElementById('communityFilterStatus');
  function filterMessage(value) {
    if (!filterStatus) return;
    filterStatus.textContent = value;
    filterStatus.hidden = !value;
  }
  const client = supabase.createClient('https://fiepaguycecrredwrcwx.supabase.co', 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE');
  let page = 0;
  let following = false;
  let loading = false;
  let filterRevision = 0;
  let pendingReset = false;
  const limit = isHome ? (window.matchMedia('(max-width:640px)').matches ? 2 : 3) : 15;
  const dateString = value => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.valueOf()) ? parsed.toLocaleString('ja-JP', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
  };
  const el = (tag, cls, text) => {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };
  function safeUrl(link) {
    // Only internal canonical links. Never trust a URL provided by an activity row.
    return Number.isSafeInteger(Number(link)) && Number(link) > 0 ? String(Number(link)) : null;
  }
  function requireLogin() {
    const next = encodeURIComponent(location.pathname.split('/').pop() + location.search + location.hash);
    location.href = 'login.html?redirect=' + next;
  }
  function message(value) {
    root.replaceChildren(el('p', 'community-state', value));
  }
  async function authed() {
    const {data,error} = await client.auth.getSession();
    if (error) throw error;
    return data?.session?.user || null;
  }
  async function rpc(name, payload) {
    const result = await client.rpc(name, payload);
    if (result.error) throw result.error;
    return result.data;
  }
  function profile(row) {
    const wrapper = el('div', 'community-person');
    const avatar = el('span', 'community-avatar', String(row.author_name || '作').slice(0, 1));
    avatar.setAttribute('aria-hidden', 'true');
    const authorId = typeof row.author_user_id === 'string' && /^[0-9a-f-]{36}$/i.test(row.author_user_id) ? row.author_user_id : null;
    const name = authorId ? el('a', '', row.author_name || '作者') : el('span', '', row.author_name || 'NOVELIGHT公式');
    if (authorId) name.href = 'author.html?id=' + encodeURIComponent(authorId);
    wrapper.append(avatar, name, el('time', 'community-date', dateString(row.occurred_at)));
    return wrapper;
  }
  function linkToNovel(row) {
    const novelId = safeUrl(row.novel_id);
    if (!novelId) return null;
    const anchor = el('a', 'community-link');
    const episodeId = safeUrl(row.episode_id);
    anchor.href = episodeId
      ? 'episode.html?id=' + encodeURIComponent(episodeId) + '&source=community'
      : 'novel.html?id=' + encodeURIComponent(novelId) + '&source=community';
    anchor.dataset.communityWork = novelId;
    const source = String(row.thumbnail_url || '').trim();
    if (source && (/^https:\/\/[^/]+\.supabase\.co\//i.test(source) || /^assets\/[a-z0-9/_-]+\.(webp|png|jpe?g)$/i.test(source))) {
      const image = el('img');
      image.src = source;
      image.loading = 'lazy';
      image.alt = '';
      anchor.append(image);
    }
    anchor.append(el('span', '', row.novel_title || '作品を読む →'));
    return anchor;
  }
  function noteDetails(row) {
    const noteId = safeUrl(row.note_id);
    if (!noteId || !row.author_user_id) return null;
    const a = el('a', 'community-more', '近況ノートを見る →');
    a.href = 'author.html?id=' + encodeURIComponent(row.author_user_id) + '#author-notes';
    return a;
  }
  function curationDetails(row) {
    const token = String(row.curation_share_token || '');
    if (row.kind !== 'curation' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) return null;
    const a = el('a', 'community-more', 'おすすめリストを見る →');
    a.href = 'curation.html?share=' + encodeURIComponent(token);
    return a;
  }
  async function toggleLike(button, row, status) {
    button.disabled = true;
    status.hidden = true;
    try {
      if (!await authed()) return requireLogin();
      const result = await rpc('novelight_community_toggle_like', {p_post_key:row.post_key});
      const count = Number(result?.like_count);
      if (typeof result?.liked !== 'boolean' || !Number.isSafeInteger(count) || count < 0) {
        throw new Error('Invalid reaction response');
      }
      row.liked_by_me = result.liked;
      row.like_count = count;
      button.setAttribute('aria-pressed', String(result.liked));
      button.textContent = '♡ ' + count;
      button.removeAttribute('title');
    } catch(error) {
      console.warn('community like failed', error);
      status.textContent = 'いいねを更新できませんでした。もう一度お試しください。';
      status.hidden = false;
    } finally { button.disabled = false; }
  }
  async function comments(container, row, onPosted, displayLimit = 20) {
    container.replaceChildren(el('p', 'community-state', 'コメントを読み込んでいます...'));
    try {
      const data = await rpc('novelight_community_comments', {
        p_post_key:row.post_key,p_limit:displayLimit
      });
      if (!Array.isArray(data)) throw new Error('Invalid comment list');
      container.replaceChildren();
      const form = el('form', 'community-comment-form');
      const input = el('input');
      input.required = true;
      input.maxLength = 500;
      input.placeholder = 'コメントを書く（500文字以内）';
      input.setAttribute('aria-label', 'コメント');
      let replyTo = null;
      const replyHint = el('p', 'community-reply-target');
      replyHint.hidden = true;
      const cancelReply = el('button', 'community-action', '返信を取り消す');
      cancelReply.type = 'button';
      cancelReply.hidden = true;
      cancelReply.addEventListener('click', () => {
        replyTo = null;
        replyHint.hidden = true;
        cancelReply.hidden = true;
        input.placeholder = 'コメントを書く（500文字以内）';
        input.focus();
      });
      for (const comment of Array.isArray(data) ? data : []) {
        const c = el('div', 'community-comment');
        const author = el('strong', '', (comment.parent_comment_id ? '↳ ' : '') + (comment.display_name || 'ユーザー'));
        c.append(author, el('span', '', comment.body || ''));
        const replyButton = el('button','community-action','返信');
        replyButton.type='button';
        replyButton.addEventListener('click',()=>{
          const id = String(comment.id || '');
          if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) return;
          replyTo = id;
          replyHint.textContent = (comment.display_name || 'ユーザー') + 'さんに返信中';
          replyHint.hidden = false;
          cancelReply.hidden = false;
          input.placeholder = '返信を書く（500文字以内）';
          input.focus();
        });
        c.append(replyButton);
        container.append(c);
      }
      if (data.length >= 20) {
        if (displayLimit === 20) {
          const older = el('button', 'community-action community-comments-older', '過去のコメントも表示（最大50件）');
          older.type = 'button';
          older.addEventListener('click', () => { void comments(container,row,onPosted,50); });
          container.append(older);
        } else if (data.length >= 50) {
          container.append(el('p', 'community-comment-tip', '最新50件までを表示しています。'));
        }
      }
      const submit = el('button', '', '送信');
      submit.type = 'submit';
      const feedback = el('p', 'community-comment-feedback');
      feedback.setAttribute('role','status');
      feedback.hidden = true;
      form.append(replyHint, cancelReply, input, submit, feedback);
      form.addEventListener('submit', async evt => {
        evt.preventDefault();
        submit.disabled = true;
        feedback.hidden = true;
        try {
          if (!await authed()) return requireLogin();
          const body = input.value.trim();
          if (!body) {
            input.setCustomValidity('コメントを入力してください');
            input.reportValidity();
            input.setCustomValidity('');
            return;
          }
          await rpc('novelight_community_post_comment',{
            p_post_key:row.post_key,p_body:body,p_parent_comment_id:replyTo
          });
          if (typeof onPosted === 'function') onPosted();
          await comments(container,row,onPosted,displayLimit);
        } catch(error) {
          console.warn('community comment failed',error);
          feedback.textContent = 'コメントを送信できませんでした。内容を確認して再度お試しください。';
          feedback.hidden = false;
        } finally {submit.disabled=false;}
      });
      container.append(form);
    } catch(error) {
      console.warn('community comments unavailable',error);
      const state = el('p', 'community-state', 'コメントを表示できませんでした。');
      state.setAttribute('role','status');
      const retry = el('button', 'community-action', 'もう一度読み込む');
      retry.type = 'button';
      retry.addEventListener('click',() => { void comments(container,row,onPosted,displayLimit); });
      state.append(el('span','', ' '),retry);
      container.replaceChildren(state);
    }
  }
  function card(row) {
    const article = el('article', 'community-card');
    article.id = 'post-' + String(row.post_key || '').replace(/[^a-z0-9:_-]/gi,'');
    article.append(profile(row));
    const typeLabels = {novel:'新作公開',episode:'エピソード更新',note:'近況ノート',curation:'おすすめリスト',seed:'LIGHT SEED',official:'NOVELIGHT公式'};
    article.append(el('span','community-type',typeLabels[row.kind] || 'お知らせ'));
    article.append(el('h3','community-card-title',row.title || '新しい活動'));
    if (row.body) {
      const body = el('p','community-card-body',row.body);
      article.append(body);
      if (row.body.length > 110) {
        const expand = el('button','community-expand','全文を表示');
        expand.type='button';expand.addEventListener('click',()=>{
          const open = article.classList.toggle('is-expanded');
          expand.textContent=open?'閉じる':'全文を表示';
          expand.setAttribute('aria-expanded',String(open));
        });
        article.append(expand);
      }
    }
    const link = linkToNovel(row) || noteDetails(row) || curationDetails(row);
    if (link) article.append(link);
    const actions = el('div','community-actions');
    const like = el('button','community-action','♡ '+Number(row.like_count||0));
    like.type='button';
    like.setAttribute('aria-label','いいね');
    like.setAttribute('aria-pressed',String(row.liked_by_me===true));
    const likeStatus = el('span', 'community-like-status');
    likeStatus.setAttribute('role', 'status');
    likeStatus.hidden = true;
    like.addEventListener('click',()=>{void toggleLike(like,row,likeStatus);});
    const comment = el('button','community-action','コメント '+Number(row.comment_count||0));
    comment.type='button';
    comment.setAttribute('aria-expanded','false');
    const commentArea = el('div','community-comment-panel');
    commentArea.hidden = true;
    comment.addEventListener('click',()=>{
      commentArea.hidden=!commentArea.hidden;
      comment.setAttribute('aria-expanded',String(!commentArea.hidden));
      if (!commentArea.hidden) void comments(commentArea,row,()=>{
        row.comment_count=Number(row.comment_count||0)+1;
        comment.textContent='コメント '+row.comment_count;
      });
    });
    actions.append(like,comment,likeStatus);
    const report = el('button', 'community-action', '通報');
    report.type = 'button';
    report.setAttribute('aria-expanded', 'false');
    const reportForm = el('form', 'community-report-form');
    reportForm.id = article.id + '-report';
    reportForm.hidden = true;
    report.setAttribute('aria-controls', reportForm.id);
    const reason = el('textarea');
    reason.required = true;
    reason.maxLength = 500;
    reason.rows = 3;
    reason.placeholder = '通報理由を入力（500文字以内）';
    reason.setAttribute('aria-label', '通報理由');
    const reportButtons = el('div', 'community-report-buttons');
    const sendReport = el('button', 'community-report-submit', '通報を送信');
    sendReport.type = 'submit';
    const cancelReport = el('button', 'community-action', 'キャンセル');
    cancelReport.type = 'button';
    const reportStatus = el('p', 'community-report-status');
    reportStatus.setAttribute('role', 'status');
    reportStatus.hidden = true;
    function closeReport() {
      reportForm.hidden = true;
      report.setAttribute('aria-expanded', 'false');
      report.focus();
    }
    report.addEventListener('click', () => {
      reportForm.hidden = !reportForm.hidden;
      report.setAttribute('aria-expanded', String(!reportForm.hidden));
      reportStatus.hidden = true;
      if (!reportForm.hidden) reason.focus();
    });
    cancelReport.addEventListener('click', closeReport);
    reportForm.addEventListener('submit', async event => {
      event.preventDefault();
      const text = reason.value.trim();
      if (!text) {
        reason.setCustomValidity('通報理由を入力してください');
        reason.reportValidity();
        reason.setCustomValidity('');
        return;
      }
      sendReport.disabled = true;
      cancelReport.disabled = true;
      try {
        if (!await authed()) return requireLogin();
        const accepted = await rpc('novelight_community_report', {
          p_post_key: row.post_key, p_reason: text
        });
        if (accepted !== true) throw new Error('Report was not accepted');
        report.textContent = '通報済み';
        report.disabled = true;
        reportStatus.textContent = '通報を受け付けました';
        reportStatus.hidden = false;
        closeReport();
      } catch(error) {
        console.warn('community report failed', error);
        reportStatus.textContent = '送信できませんでした。時間をおいて再度お試しください。';
        reportStatus.hidden = false;
      } finally {
        sendReport.disabled = false;
        cancelReport.disabled = false;
      }
    });
    reportButtons.append(sendReport, cancelReport);
    reportForm.append(reason, reportButtons, reportStatus);
    actions.append(report);
    article.append(actions, commentArea, reportForm);
    return article;
  }
  async function load(reset=true) {
    if (loading) {
      // A filter change must not disappear behind a slower request.
      if (reset) pendingReset = true;
      return;
    }
    loading=true;
    if (refreshButton) refreshButton.disabled = true;
    const revision=filterRevision;
    const requestedFollowing=following;
    if(reset){
      page=0;
      message('交流を読み込んでいます...');
      const more = document.getElementById('communityLoadMore');
      if (more) more.hidden = true;
    } else {
      root.querySelector('.community-load-error')?.remove();
    }
    try {
      if (page * limit > 300) {
        const more = document.getElementById('communityLoadMore');
        if (more) more.hidden = true;
        return;
      }
      const data=await rpc('novelight_community_feed',{p_limit:limit,p_offset:page*limit,p_following:requestedFollowing});
      // A stale response must never overwrite the selected filter.
      if (revision !== filterRevision) return;
      const list=Array.isArray(data)?data:[];
      if(reset)root.replaceChildren();
      if(!list.length && page===0) {
        const empty=el('p','community-state','まだ公開中の交流はありません。作品の更新や近況が公開されると、ここに表示されます。');
        const official=el('a','community-more','公式のお知らせを見る →');
        official.href='announcements.html';
        empty.append(el('span','', ' '),official);
        root.append(empty);
      }
      for(const item of list) root.append(card(item));
      const more=document.getElementById('communityLoadMore');
      if(more)more.hidden=list.length<limit || (page+1)*limit>300;
      page += 1;
      return true;
    } catch(error) {
      console.warn('community feed unavailable; rest of page remains usable',error);
      if (revision===filterRevision) {
        const errorState=el('p','community-state',reset
          ? '交流を読み込めませんでした。作品の閲覧は通常どおり利用できます。'
          : '追加の投稿を読み込めませんでした。');
        errorState.classList.add('community-load-error');
        errorState.setAttribute('role','status');
        const retry=el('button','community-action','もう一度読み込む');
        retry.type='button';
        retry.addEventListener('click',()=>{void load(reset);});
        errorState.append(el('span','', ' '),retry);
        if(reset)root.replaceChildren(errorState);
        else root.append(errorState);
      }
      return false;
    } finally {
      loading=false;
      if (refreshButton) refreshButton.disabled = false;
      if(pendingReset){
        pendingReset=false;
        void load(true);
      }
    }
  }
  document.getElementById('communityLoadMore')?.addEventListener('click',()=>{void load(false);});
  refreshButton?.addEventListener('click',()=>{
    filterMessage('');
    filterRevision += 1;
    void load(true);
  });
  document.querySelectorAll('[data-community-filter]').forEach(button=>{
    button.addEventListener('click',async()=>{
      const requested = button.dataset.communityFilter==='following';
      try {
        if(requested && !(await authed()))return requireLogin();
      } catch(error) {
        console.warn('community following filter unavailable',error);
        filterMessage('フォロー中の投稿を確認できませんでした。再度お試しください。');
        return;
      }
      filterMessage('');
      following=requested;
      filterRevision += 1;
      document.querySelectorAll('[data-community-filter]').forEach(item=>{
        item.setAttribute('aria-pressed',String(item===button));
      });
      void load(true);
    });
  });
  // Notification links may reference a post older than the first 15 rows.
  // Only a direct #post-* visit performs this bounded lookup; ordinary pages
  // never prefetch extra activity. The RPC itself caps offsets at 300.
  function linkedPostId() {
    if (isHome || !location.hash.startsWith('#post-')) return null;
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return null; }
    return /^post-(?:novel:[0-9]+|note:[0-9]+|curation:[0-9]+|seed:[a-f0-9-]{36}|official:[0-9]+|ep:[a-f0-9-]{36}:[0-9]+:[0-9]+)$/i.test(id)
      ? id : null;
  }
  void (async () => {
    await load();
    const target = linkedPostId();
    if (!target) return;
    const revision = filterRevision;
    for (let attempt = 0; attempt <= 20; attempt += 1) {
      if (filterRevision !== revision) return;
      const found = document.getElementById(target);
      if (found) {
        found.setAttribute('tabindex', '-1');
        found.scrollIntoView({block:'center'});
        found.focus({preventScroll:true});
        return;
      }
      const more = document.getElementById('communityLoadMore');
      if (!more || more.hidden) break;
      if (!await load(false)) break;
    }
    if (filterRevision === revision) {
      const notice = el('p', 'community-state', '指定された投稿は見つかりませんでした。公開終了または閲覧制限の可能性があります。');
      notice.setAttribute('role', 'status');
      root.prepend(notice);
    }
  })();
})();
