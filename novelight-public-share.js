(() => {
'use strict';
const ORIGIN='https://novelight.jp';
const slug=()=>((location.pathname.split('/').pop()||'index.html').replace(/\.html$/u,'').replace(/[^a-z0-9-]/giu,'-').toLowerCase());
if(!new Set(['my-novels','novel','episode']).has(slug()))return;
const q=(s,r=document)=>r.querySelector(s);
const url=(page,id)=>{const u=new URL(page,`${ORIGIN}/`);u.searchParams.set('id',String(id));return u.toString();};
const idFrom=href=>{try{return new URL(href||'',location.href).searchParams.get('id')}catch{return null}};
function styles(){
  if(q('#novelight-public-share-style'))return;
  const s=document.createElement('style');s.id='novelight-public-share-style';
  s.textContent='.novelight-public-share{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 0;padding:12px;border:1px solid #e2e0ea;border-radius:12px;background:#faf9ff}.novelight-public-share-label{margin-right:2px;color:#5d566d;font-size:12px;font-weight:900}.novelight-public-share-action{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:8px 12px;border:1px solid #cbc5e8;border-radius:8px;background:#fff;color:#443875;font:inherit;font-size:12px;font-weight:900;line-height:1.2;text-decoration:none;cursor:pointer}.novelight-public-share-action:hover{border-color:#9b89e8;background:#f5f2ff;color:#443875}.novelight-public-share-action:focus-visible{outline:3px solid rgba(109,74,255,.35);outline-offset:2px}.novelight-public-share-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.novelight-public-share.episode-share{margin:18px 0}@media(max-width:600px){.novelight-public-share{align-items:stretch}.novelight-public-share-label{flex:1 1 100%}.novelight-public-share-action{flex:1 1 calc(50% - 8px)}.novelight-public-share-action.open{flex-basis:100%}}';
  document.head.append(s);
}
function fallbackCopy(text){const t=document.createElement('textarea');t.value=text;t.readOnly=true;t.style.cssText='position:fixed;opacity:0;pointer-events:none';document.body.append(t);t.select();const ok=document.execCommand('copy');t.remove();if(!ok)throw new Error('copy rejected');}
async function copy(text){if(navigator.clipboard?.writeText&&window.isSecureContext)return navigator.clipboard.writeText(text);fallbackCopy(text);}
function flash(button,text,ms=1400){const before=button.dataset.originalLabel||button.textContent;button.dataset.originalLabel=before;button.textContent=text;setTimeout(()=>{if(button.isConnected)button.textContent=before},ms);}
function bar({shareUrl,text,label,open=false,position=''}) {
  const host=document.createElement('div');host.className='novelight-public-share'+(position.startsWith('episode-')?' episode-share':'');host.dataset.novelightPublicShare=position;
  const head=document.createElement('span');head.className='novelight-public-share-label';head.textContent=label;host.append(head);
  if(open){const a=document.createElement('a');a.className='novelight-public-share-action open';a.href=shareUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='公開ページを見る';host.append(a);}
  const status=document.createElement('span');status.className='novelight-public-share-status';status.role='status';status.ariaLive='polite';
  const c=document.createElement('button');c.type='button';c.className='novelight-public-share-action copy';c.textContent='URLをコピー';c.onclick=async()=>{try{await copy(shareUrl);flash(c,'コピーしました');status.textContent='公開URLをコピーしました。'}catch(e){console.error('public share URL copy failed',e);flash(c,'コピーできませんでした',1800);status.textContent='URLをコピーできませんでした。';}};
  const x=document.createElement('button');x.type='button';x.className='novelight-public-share-action x';x.textContent='Xでシェア';x.onclick=()=>{const u=new URL('https://twitter.com/intent/tweet');u.searchParams.set('text',text);u.searchParams.set('url',shareUrl);const p=window.open(u.toString(),'_blank','noopener,noreferrer');if(p)p.opener=null;};
  host.append(c,x,status);return host;
}
function myNovels(){
  const list=q('#list');if(!list)return;
  const mount=()=>list.querySelectorAll('.card').forEach(card=>{if(q('[data-novelight-public-share]',card))return;const state=q('.state',card),link=q('.title[href*="novel.html"]',card),actions=q('.work-actions',card);if(!state?.textContent.includes('公開中')||!link||!actions)return;const id=idFrom(link.href);if(!id)return;actions.before(bar({shareUrl:url('novel.html',id),text:`『${link.textContent.trim()||'作品'}』をNOVELIGHTで読む`,label:'作品を共有',open:true,position:'work-card'}));});
  mount();new MutationObserver(mount).observe(list,{childList:true,subtree:true});
}
function novel(){
  const header=q('#novelHeader'),id=new URLSearchParams(location.search).get('id');if(!header||!id)return;
  const mount=()=>{if(q('[data-novelight-public-share]',header))return;const title=q('.title',header);if(!title)return;header.append(bar({shareUrl:url('novel.html',id),text:`『${title.textContent.trim()||'作品'}』をNOVELIGHTで読む`,label:'この作品を共有',position:'novel'}));};
  mount();new MutationObserver(mount).observe(header,{childList:true,subtree:true});
  if(!q('script[data-nlv2-loader]')){const s=document.createElement('script');s.src='novelight-novel-detail-ui.js';s.dataset.nlv2Loader='1';document.head.append(s);}
}
function episode(){
  const card=q('#card'),id=new URLSearchParams(location.search).get('id');if(!card||!id)return;
  const mount=()=>{if(q('[data-novelight-public-share="episode-top"]',card))return;const title=q('h1',card),content=q('.content',card),novelLink=q('.novel-title a',card);if(!title||!content||!novelLink)return;const shareUrl=url('episode.html',id),text=`『${novelLink.textContent.trim()||'作品'}』 ${title.textContent.trim()||'エピソード'}｜NOVELIGHT`;title.after(bar({shareUrl,text,label:'このエピソードを共有',position:'episode-top'}));content.after(bar({shareUrl,text,label:'読了したエピソードを共有',position:'episode-bottom'}));};
  mount();new MutationObserver(mount).observe(card,{childList:true,subtree:true});
}
styles();if(slug()==='my-novels')myNovels();if(slug()==='novel')novel();if(slug()==='episode')episode();
})();