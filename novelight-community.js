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
  const client = supabase.createClient('https://fiepaguycecrredwrcwx.supabase.co', 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE');
  let page = 0;
  let following = false;
  let loading = false;
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
    const next = encodeURIComponent(location.pathname.split('/').pop() + location.search);
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
  async function toggleLike(button, row) {
    button.disabled = true;
    try {
      if (!await authed()) return requireLogin();
      const result = await rpc('novelight_community_toggle_like', {p_post_key:row.post_key});
      button.setAttribute('aria-pressed', String(result?.liked === true));
      button.textContent = '♡ ' + Number(result?.like_count || 0);
    } catch(error) {
      console.warn('community like failed', error);
      button.title = '操作できませんでした。もう一度お試しください';
    } finally { button.disabled = false; }
  }
  async function comments(container, row) {
    container.replaceChildren(el('p', 'community-state', 'コメントを読み込んでいます...'));
    try {
      const data = await rpc('novelight_community_comments', {p_post_key:row.post_key,p_limit:20});
      container.replaceChildren();
      const form = el('form', 'community-comment-form');
      const input = el('input');
      input.required = true;
      input.maxLength = 500;
      input.placeholder = 'コメントを書く（500文字以内）';
      input.setAttribute('aria-label', 'コメント');
      let replyTo = null;
      for (const comment of Array.isArray(data) ? data : []) {
        const c = el('div', 'community-comment');
        const author = el('strong', '', (comment.parent_comment_id ? '↳ ' : '') + (comment.display_name || 'ユーザー'));
        c.append(author, el('span', '', comment.body || ''));
        const replyButton = el('button','community-action','返信');
        replyButton.type='button';
        replyButton.addEventListener('click',()=>{
          replyTo = String(comment.id || '');
          input.placeholder = (comment.display_name || 'ユーザー') + 'さんへの返信';
          input.focus();
        });
        c.append(replyButton);
        container.append(c);
      }
      const submit = el('button', '', '送信');
      submit.type = 'submit';
      form.append(input,submit);
      form.addEventListener('submit', async evt => {
        evt.preventDefault();
        submit.disabled = true;
        try {
          if (!await authed()) return requireLogin();
          await rpc('novelight_community_post_comment',{
            p_post_key:row.post_key,p_body:input.value.trim(),p_parent_comment_id:replyTo
          });
          await comments(container,row);
        } catch(error) {
          console.warn('community comment failed',error);
          input.setCustomValidity('コメントを送信できませんでした');
          input.reportValidity();
          input.setCustomValidity('');
        } finally {submit.disabled=false;}
      });
      container.append(form);
    } catch(error) {
      console.warn('community comments unavailable',error);
      container.replaceChildren(el('p', 'community-state', 'コメントを表示できませんでした'));
    }
  }
  function card(row) {
    const article = el('article', 'community-card');
    article.id = 'post-' + String(row.post_key || '').replace(/[^a-z0-9:_-]/gi,'');
    article.append(profile(row));
    const typeLabels = {novel:'新作公開',episode:'エピソード更新',note:'近況ノート',curation:'おすすめリスト',official:'NOVELIGHT公式'};
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
    like.addEventListener('click',()=>{void toggleLike(like,row);});
    const comment = el('button','community-action','コメント '+Number(row.comment_count||0));
    comment.type='button';
    comment.setAttribute('aria-expanded','false');
    const commentArea = el('div','community-comment-panel');
    commentArea.hidden = true;
    comment.addEventListener('click',()=>{
      commentArea.hidden=!commentArea.hidden;
      comment.setAttribute('aria-expanded',String(!commentArea.hidden));
      if (!commentArea.hidden) void comments(commentArea,row);
    });
    actions.append(like,comment);
    const report = el('button','community-action','通報');
    report.type='button';
    report.addEventListener('click', async()=>{
      if (!await authed()) return requireLogin();
      const reason=window.prompt('通報理由を入力してください（500文字以内）');
      if (!reason?.trim()) return;
      try {
        await rpc('novelight_community_report',{p_post_key:row.post_key,p_reason:reason.trim().slice(0,500)});
        report.textContent='通報済み';
        report.disabled=true;
      } catch(error){console.warn('community report failed',error);report.title='通報できませんでした';}
    });
    actions.append(report);
    article.append(actions,commentArea);
    return article;
  }
  async function load(reset=true) {
    if (loading) return;
    loading=true;
    if(reset){page=0; message('交流を読み込んでいます...');}
    try {
      const data=await rpc('novelight_community_feed',{p_limit:limit,p_offset:page*limit,p_following:following});
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
      if(more)more.hidden=list.length<limit;
      page += 1;
    } catch(error) {
      console.warn('community feed unavailable; rest of page remains usable',error);
      if(reset)message('交流を読み込めませんでした。作品の閲覧は通常どおり利用できます。');
    } finally {loading=false;}
  }
  document.getElementById('communityLoadMore')?.addEventListener('click',()=>{void load(false);});
  document.querySelectorAll('[data-community-filter]').forEach(button=>{
    button.addEventListener('click',async()=>{
      const requested = button.dataset.communityFilter==='following';
      if(requested && !(await authed()))return requireLogin();
      following=requested;
      document.querySelectorAll('[data-community-filter]').forEach(item=>{
        item.setAttribute('aria-pressed',String(item===button));
      });
      void load(true);
    });
  });
  void load().then(() => {
    if (!isHome && location.hash.startsWith('#post-')) {
      document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({block:'center'});
    }
  });
})();
