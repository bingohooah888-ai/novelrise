/* Community reaction notices, separate from pre-existing author-follow event notifications. */
(() => {
  if (window.NOVELIGHT_COMMUNITY_FLAGS?.timeline !== true) return;
  const target = document.getElementById('communityNotifications');
  if (!target || !window.supabase) return;
  const client = supabase.createClient('https://fiepaguycecrredwrcwx.supabase.co','sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE');
  const item = (tag,text) => { const el = document.createElement(tag); el.textContent=text; return el; };
  void (async()=>{
    try {
      const auth=await client.auth.getSession();
      if(auth.error || !auth.data.session?.user) return;
      const {data,error}=await client.rpc('novelight_community_my_notifications',{p_limit:10});
      if(error) throw error;
      if(!Array.isArray(data) || !data.length) return;
      const title=item('h2','あなたへの交流');
      const list=document.createElement('ul');
      for(const notice of data) {
        const li=document.createElement('li');
        const label=notice.kind==='like'?'いいね':notice.kind==='reply'?'返信':'コメント';
        li.append(item('span',(notice.actor_name||'ユーザー')+'さんから'+label+'が届きました'));
        const link=item('a',' 投稿を確認');
        link.href='community.html#post-'+encodeURIComponent(String(notice.post_key||''));
        li.append(link);list.append(li);
      }
      target.append(title,list);target.hidden=false;
    }catch(err){ console.warn('community notifications unavailable',err); }
  })();
})();
