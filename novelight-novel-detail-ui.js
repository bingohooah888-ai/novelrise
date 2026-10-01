(() => {
'use strict';
if ((location.pathname.split('/').pop() || '') !== 'novel.html') return;

const q = (s, r=document) => r.querySelector(s);
const qa = (s, r=document) => [...r.querySelectorAll(s)];
const idFromHref = href => {
  try { return new URL(href, location.href).searchParams.get('id'); }
  catch { return null; }
};
const progress = novelId => {
  try { return JSON.parse(localStorage.getItem(`novelight:reading:v1:${novelId}`) || 'null'); }
  catch { return null; }
};
const waitFor = selector => new Promise(resolve => {
  const hit = q(selector);
  if (hit) return resolve(hit);
  const observer = new MutationObserver(() => {
    const node = q(selector);
    if (!node) return;
    observer.disconnect();
    resolve(node);
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
});

function installStyle() {
  if (q('#nlv2-style')) return;
  const s=document.createElement('style');
  s.id='nlv2-style';
  s.textContent=`
  body.nlv2-ready main{max-width:1420px!important;padding-left:24px!important;padding-right:24px!important}
  body.nlv2-ready #novelHeader{padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important;overflow:visible!important}
  .nlv2-grid{display:grid;grid-template-columns:minmax(210px,270px) minmax(390px,1fr) minmax(270px,330px);gap:24px;align-items:start}
  .nlv2-left{position:sticky;top:20px;min-width:0}
  .nlv2-center{min-width:0;padding:30px;border:1px solid #e3d8c9;border-radius:16px;background:#fffdf9;box-shadow:0 12px 34px rgba(66,50,34,.05)}
  .nlv2-cover{width:100%;aspect-ratio:2/3;overflow:hidden;border:1px solid #d4c5b2;border-radius:12px;background:#eee5d8;box-shadow:0 18px 38px rgba(52,39,26,.16)}
  .nlv2-cover img{width:100%;height:100%;object-fit:cover;display:block}
  .nlv2-left .tags{margin-top:14px;padding:14px;border:1px solid #e1d5c5;border-radius:12px;background:rgba(255,253,248,.92)}
  .nlv2-seeds{margin-top:12px;padding:13px;border:1px solid #e1d5c5;border-radius:12px;background:rgba(255,253,248,.92)}
  .nlv2-seeds h3{margin:0 0 8px;font-size:12px;letter-spacing:.08em;color:#6b5947}
  .nlv2-seed-row{display:flex;gap:6px;flex-wrap:wrap}.nlv2-seed-row span{padding:4px 7px;border:1px solid #e2d8ca;border-radius:999px;background:#fff;font-size:10px;font-weight:850;color:#675b50}
  .nlv2-center .title{margin:0 0 10px!important;font-size:clamp(29px,3vw,42px)!important;line-height:1.38!important;font-family:"Yu Mincho","Hiragino Mincho ProN",serif}
  .nlv2-center .author{margin:0 0 18px!important;color:#75695e}.nlv2-center .meta{margin:0 0 20px!important;padding:11px 0!important;border-top:1px solid #eee4d8;border-bottom:1px solid #eee4d8;color:#85786b}
  .nlv2-story{padding:18px 0 4px}.nlv2-kicker{margin-bottom:7px;color:#9a7b4e;font-size:10px;font-weight:900;letter-spacing:.15em}.nlv2-story h2,.nlv2-characters h2{margin:0 0 10px;font-size:18px}.nlv2-story .description{margin:0!important;line-height:2!important;color:#514a43!important;white-space:pre-wrap}
  .nlv2-actions{display:flex;gap:9px;align-items:stretch;flex-wrap:wrap;margin-top:24px;padding-top:20px;border-top:1px solid #eee4d8}
  .nlv2-actions #nlContinueReading{order:-10;flex:1 1 230px;min-height:50px!important}
  .nlv2-actions .favorite,.nlv2-actions .nl-book-control-button,.nlv2-actions #curationAddButton,.nlv2-actions .nlv2-toc-open,.nlv2-actions #readerReportOpen{min-height:44px;padding:9px 12px;border:1px solid #d9ccbb;border-radius:9px;background:#fff;color:#4b3b2c;font-weight:850;cursor:pointer}
  .nlv2-actions .nl-book-control{display:contents}.nlv2-actions .nl-book-panel,.nlv2-actions #curationAddPanel{flex:1 0 100%}
  .nlv2-actions .novelight-public-share{display:flex!important;gap:8px!important;align-items:center!important;flex:1 0 100%;margin:0!important;padding:0!important;border:0!important;background:transparent!important}
  .nlv2-actions .novelight-public-share-label{display:none}.nlv2-actions .novelight-public-share-action{border-color:#d9ccbb!important;color:#4b3b2c!important;background:#fff!important}
  .nlv2-toc-open{display:none}
  .nlv2-characters{margin-top:24px;padding-top:22px;border-top:1px solid #eee4d8}
  .nlv2-char-head{display:flex;justify-content:space-between;gap:16px;align-items:end;margin-bottom:12px}.nlv2-char-head p{margin:0;color:#8a7e72;font-size:11px}
  .nlv2-char-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
  .nlv2-char{min-width:0;padding:12px;border:1px solid #e7ded3;border-radius:10px;background:#fff}.nlv2-char.has-image{display:grid;grid-template-columns:52px minmax(0,1fr);gap:10px;align-items:center}
  .nlv2-char img{width:52px;height:64px;border-radius:8px;object-fit:cover;background:#eee6dc}.nlv2-char strong{display:block;margin-bottom:4px;font-size:13px}.nlv2-char span{display:block;color:#857a6e;font-size:10px;line-height:1.55}
  .nlv2-more{margin-top:10px;border:0;background:transparent;color:#765b37;font-weight:900;font-size:12px;cursor:pointer}
  .nlv2-toc{position:sticky;top:20px;max-height:calc(100vh - 40px);overflow:auto;padding:18px;border:1px solid #e3d8c9;border-radius:14px;background:#fffdf9;box-shadow:0 12px 34px rgba(66,50,34,.05)}
  .nlv2-toc-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px}.nlv2-toc h2{margin:0;font-size:17px}.nlv2-count{font-size:10px;color:#948778}
  .nlv2-chapter{margin:14px 0 5px;padding:8px 7px;border-left:3px solid #aa8a5d;background:#faf5ec;color:#5a4732;font-size:12px;font-weight:900}
  .nlv2-ep{position:relative;display:block;padding:8px 8px 8px 26px;border-radius:7px;color:#51483f!important;text-decoration:none!important;font-size:11px;line-height:1.45}.nlv2-ep:hover{background:#f8f1e6}.nlv2-ep:before{content:"";position:absolute;left:9px;top:15px;width:6px;height:6px;border:1px solid #c8b9a7;border-radius:50%;background:#fff}
  .nlv2-ep.read{color:#91867b!important}.nlv2-ep.read:before{background:#bba98f;border-color:#bba98f}.nlv2-ep.current{background:#f7efe1;color:#4c3721!important;font-weight:900}.nlv2-ep.current:before{background:#8d673a;border-color:#8d673a;box-shadow:0 0 0 3px #eee1ce}
  .nlv2-ep-num{display:block;color:#9b8f82;font-size:9px}
  body.nlv2-ready #episodesPanel{display:none!important}
  .nlv2-backdrop{position:fixed;inset:0;z-index:79;display:none;background:rgba(38,29,21,.45)}.nlv2-backdrop.on{display:block}
  .nlv2-drawer{position:fixed;left:0;right:0;bottom:0;z-index:80;max-height:78vh;transform:translateY(105%);transition:transform .22s ease;background:#fffdf9;border-radius:18px 18px 0 0;box-shadow:0 -16px 45px rgba(44,33,24,.18);display:flex;flex-direction:column}.nlv2-drawer.on{transform:translateY(0)}
  .nlv2-drawer-head{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;border-bottom:1px solid #e9dfd2}.nlv2-close{width:38px;height:38px;border:1px solid #dfd4c5;border-radius:50%;background:#fff;font-size:20px}.nlv2-drawer-body{overflow:auto;padding:8px 14px 24px}
  @media(max-width:1100px){body.nlv2-ready main{max-width:1040px!important}.nlv2-grid{grid-template-columns:220px minmax(0,1fr)}.nlv2-toc{display:none}.nlv2-toc-open{display:inline-flex;align-items:center;justify-content:center}}
  @media(max-width:760px){body.nlv2-ready main{padding:24px 14px 64px!important}.nlv2-grid{grid-template-columns:1fr;gap:16px}.nlv2-left{position:static}.nlv2-cover{width:min(62vw,230px);margin:0 auto}.nlv2-left .tags,.nlv2-seeds{max-width:520px;margin-left:auto;margin-right:auto}.nlv2-center{padding:22px 18px}.nlv2-actions{display:grid;grid-template-columns:1fr 1fr}.nlv2-actions #nlContinueReading{grid-column:1/-1}.nlv2-actions .novelight-public-share,.nlv2-actions .nl-book-panel,.nlv2-actions #curationAddPanel{grid-column:1/-1}.nlv2-char-grid{grid-template-columns:1fr}}
  @media(max-width:480px){.nlv2-actions{grid-template-columns:1fr}.nlv2-actions #nlContinueReading,.nlv2-actions .novelight-public-share,.nlv2-actions .nl-book-panel,.nlv2-actions #curationAddPanel{grid-column:auto}}
  `;
  document.head.appendChild(s);
}

function episodeRows(){
  return qa('#episodeList .episode').map(node => {
    const a=q('a[href*="episode.html?id="]',node);
    const num=(q('.episode-number',node)?.textContent||'').match(/第\s*(\d+)\s*話/u);
    if(!a||!num)return null;
    return {id:idFromHref(a.href),href:a.href,num:Number(num[1]),title:a.textContent.trim(),node};
  }).filter(Boolean);
}
function stateFor(row,rows,stored){
  if(!stored)return '';
  const ci=rows.findIndex(x=>String(x.id)===String(stored.episodeId));
  const ri=rows.indexOf(row);
  if(ci<0||ri<0)return '';
  const done=Number(stored.progressRatio||0)>=.85;
  if(ri<ci||(ri===ci&&done))return 'read';
  if(ri===ci&&!done||done&&ri===ci+1)return 'current';
  return '';
}
function tocContent(rows,stored){
  const f=document.createDocumentFragment();let chapter='';
  for(const row of rows){
    const prev=row.node.previousElementSibling;
    if(prev?.classList.contains('chapter-heading')){
      const text=prev.textContent.trim();
      if(text&&text!==chapter){const h=document.createElement('div');h.className='nlv2-chapter';h.textContent=text;f.append(h);chapter=text;}
    }
    const a=document.createElement('a');a.href=row.href;a.className=`nlv2-ep ${stateFor(row,rows,stored)}`.trim();
    const n=document.createElement('span');n.className='nlv2-ep-num';n.textContent=`第${row.num}話`;
    const t=document.createElement('span');t.textContent=row.title||`第${row.num}話`;
    a.append(n,t);f.append(a);
  }
  return f;
}
function installDrawer(rows,stored,button){
  const back=document.createElement('div');back.className='nlv2-backdrop';
  const drawer=document.createElement('section');drawer.className='nlv2-drawer';drawer.setAttribute('role','dialog');drawer.setAttribute('aria-modal','true');drawer.setAttribute('aria-label','目次');
  drawer.innerHTML='<div class="nlv2-drawer-head"><strong>目次</strong><button class="nlv2-close" type="button" aria-label="目次を閉じる">×</button></div><div class="nlv2-drawer-body"></div>';
  q('.nlv2-drawer-body',drawer).append(tocContent(rows,stored));
  document.body.append(back,drawer);let ret=null;
  const close=()=>{drawer.classList.remove('on');back.classList.remove('on');document.body.style.overflow='';ret?.focus?.();ret=null;};
  button.onclick=e=>{ret=e.currentTarget;drawer.classList.add('on');back.classList.add('on');document.body.style.overflow='hidden';q('.nlv2-close',drawer).focus();};
  q('.nlv2-close',drawer).onclick=close;back.onclick=close;
  drawer.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close();}};
}
function seedMini(host){
  host.innerHTML='<h3>LIGHT SEED</h3><div class="nlv2-seed-row"></div>';
  const render=()=>{const row=q('.nlv2-seed-row',host);row.replaceChildren();for(const [label,id] of [['GOLD','receivedSeedGold'],['SILVER','receivedSeedSilver'],['BRONZE','receivedSeedBronze']]){const x=document.createElement('span');const v=q(`#${id}`)?.textContent?.trim();x.textContent=`${label} ${v&&v!=='—'?v:'0'}`;row.append(x);}};
  render();const target=q('#receivedSeedArea');if(target)new MutationObserver(render).observe(target,{subtree:true,childList:true,characterData:true});
}
async function characters(client,rows,stored,host){
  const boundary=rows.find(x=>String(x.id)===String(stored?.episodeId||''))||rows[0];
  if(!boundary)return;
  try{
    const res=await client.rpc('novelight_character_feed',{p_episode_id:String(boundary.id)});
    if(res.error)throw res.error;
    const data=Array.isArray(res.data)?res.data:[];if(!data.length)return;
    host.hidden=false;const grid=q('.nlv2-char-grid',host),more=q('.nlv2-more',host);let expanded=false;
    const draw=()=>{grid.replaceChildren();for(const row of (expanded?data.slice(0,12):data.slice(0,3))){const card=document.createElement('article');card.className=`nlv2-char${row.image_url?' has-image':''}`;if(row.image_url){const img=document.createElement('img');img.src=row.image_url;img.alt=row.name||'登場人物';img.loading='lazy';img.referrerPolicy='no-referrer';card.append(img);}const box=document.createElement('div');const name=document.createElement('strong');name.textContent=row.name||'登場人物';const desc=document.createElement('span');desc.textContent=row.summary||(row.latest_episode_number?`第${Number(row.latest_episode_number)}話までに登場`:'登場人物');box.append(name,desc);card.append(box);grid.append(card);}more.hidden=data.length<=3;more.textContent=expanded?'表示を戻す ↑':'登場人物をもっと見る →';};
    more.onclick=()=>{expanded=!expanded;draw();};draw();
  }catch(e){console.warn('novel character presentation unavailable',e);}
}
function moveControls(actions){
  const move=()=>{
    for(const el of [q('#favoriteButton'),q('.nl-book-control'),q('#curationAddButton'),q('#curationAddPanel'),q('.novelight-public-share'),q('#readerReportOpen')]){
      if(el&&el.parentElement!==actions)actions.append(el);
    }
  };
  move();const o=new MutationObserver(move);o.observe(document.body,{childList:true,subtree:true});setTimeout(()=>o.disconnect(),25000);
}
async function boot(){
  installStyle();
  await waitFor('body.nl-novel-detail-refresh');
  await waitFor('#episodeList a[href*="episode.html?id="]');
  if(q('.nlv2-grid'))return;
  const novelId=new URLSearchParams(location.search).get('id');const header=q('#novelHeader');const hero=q('.nl-novel-hero',header);const main=q('.nl-novel-main',header);const synopsis=q('.nl-novel-description-section',header);if(!novelId||!hero||!main||!synopsis)return;
  const cover=q('.nl-novel-cover-shell',hero),tags=q('.tags',main),title=q('.title',main),author=q('.author',main),meta=q('.meta',main),actions=q('.nl-novel-actions',main);if(!cover||!title||!author||!meta||!actions)return;
  const rows=episodeRows();if(!rows.length)return;const stored=progress(novelId);

  const grid=document.createElement('div');grid.className='nlv2-grid';
  const left=document.createElement('aside');left.className='nlv2-left';
  cover.classList.add('nlv2-cover');left.append(cover);if(tags)left.append(tags);
  const seeds=document.createElement('section');seeds.className='nlv2-seeds';left.append(seeds);seedMini(seeds);

  const center=document.createElement('section');center.className='nlv2-center';center.append(title,author,meta);
  synopsis.className='nlv2-story';const desc=q('.description',synopsis);synopsis.replaceChildren(Object.assign(document.createElement('div'),{className:'nlv2-kicker',textContent:'STORY'}),Object.assign(document.createElement('h2'),{textContent:'あらすじ'}),desc);center.append(synopsis,actions);

  const oldChars=q('#nlNovelCharacters');if(oldChars)oldChars.remove();
  const chars=document.createElement('section');chars.className='nlv2-characters';chars.hidden=true;chars.innerHTML='<div class="nlv2-char-head"><div><div class="nlv2-kicker">CHARACTERS</div><h2>登場人物</h2></div><p>読了範囲までの人物を表示</p></div><div class="nlv2-char-grid"></div><button class="nlv2-more" type="button" hidden></button>';center.append(chars);

  const toc=document.createElement('aside');toc.className='nlv2-toc';toc.innerHTML=`<div class="nlv2-toc-head"><h2>目次</h2><span class="nlv2-count">${rows.length}話</span></div>`;toc.append(tocContent(rows,stored));
  const open=document.createElement('button');open.type='button';open.className='nlv2-toc-open';open.textContent='目次を見る';actions.append(open);
  installDrawer(rows,stored,open);grid.append(left,center,toc);header.replaceChildren(grid);document.body.classList.add('nlv2-ready');moveControls(actions);
  if(typeof client!=='undefined'&&client)void characters(client,rows,stored,chars);
}
void boot();
})();