/* ADMIN-only client. All operations are independently authorized server-side. */
const sb=supabase.createClient('https://fiepaguycecrredwrcwx.supabase.co','sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE');
let chosen=null,contentChosen=null,projects=[],detail=null;
const $=id=>document.getElementById(id);
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error)}
function formObject(form){const x=Object.fromEntries(new FormData(form));for(const checkbox of ['featured','pr_label','limited_label'])if(form.id==='projectForm')x[checkbox]=form.elements[checkbox].checked;for(const key of Object.keys(x)){if(x[key]==='')x[key]=null;}return x;}
function dateValue(value){if(!value)return '';const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function datify(formValue){if(!formValue)return null;const d=new Date(formValue);return Number.isFinite(d.getTime())?d.toISOString():null}
async function api(method='GET',body=null,url='/api/admin-special'){
 const {data:{session},error}=await sb.auth.getSession();if(error)throw error;
 if(!session){location.href='/login.html?redirect=admin-special.html';return null;}
 const r=await fetch(url,{method,headers:{Authorization:`Bearer ${session.access_token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store'});
 const json=await r.json().catch(()=>({}));if(r.status===403)throw new Error('このアカウントに管理者権限はありません');if(!r.ok)throw new Error(json.error||`HTTP ${r.status}`);return json;
}
function textNode(container,text,cls=''){const el=document.createElement('div');el.textContent=text;el.className=cls;container.append(el);return el;}
async function load(){const result=await api();if(!result)return;projects=result.projects||[];const list=$('projectList');list.replaceChildren();for(const p of projects){const el=document.createElement('button');el.type='button';el.className='item '+(chosen===p.id?'active':'');el.style.cssText='display:block;width:100%;text-align:left;color:inherit';el.textContent=`${p.title}　[${p.status}]　/ special/${p.slug}`;el.addEventListener('click',()=>open(p.id));list.append(el);}if(!projects.length)textNode(list,'現在、企画は登録されていません。','muted');}
async function open(id){chosen=id;contentChosen=null;$('rightsForm').reset();$('evidenceUploadStatus').textContent='';detail=await api('GET',null,`/api/admin-special?id=${encodeURIComponent(id)}`);if(!detail)return;const p=detail.project;const form=$('projectForm');for(const [name,input] of Object.entries(form.elements)){if(!input||!input.name)continue;const v=p[input.name];if(input.type==='checkbox')input.checked=Boolean(v);else if(input.type==='datetime-local')input.value=dateValue(v);else input.value=v??'';}form.elements.slug.readOnly=Boolean(p.first_published_at);$('editorTitle').textContent='企画の編集';$('statusControl').classList.remove('hidden');$('rightsControl').classList.remove('hidden');$('contentForm').classList.remove('hidden');$('currentStatus').textContent=`現在の状態: ${p.status} ／ 公開履歴: ${p.first_published_at||'なし'}`;renderContents();renderRights();renderMetrics();await load();}
function renderContents(){const list=$('contentList');list.replaceChildren();const options=$('rightContent');options.replaceChildren();for(const c of detail.contents){const item=document.createElement('button');item.type='button';item.className='item';item.style.cssText='width:100%;text-align:left;color:inherit';item.textContent=`${c.title} [${c.mode}] [${c.status}]`;item.addEventListener('click',()=>editContent(c));list.append(item);const opt=new Option(c.title,c.id);options.append(opt);}if(!detail.contents.length)textNode(list,'まだ特別コンテンツがありません。','muted');}
function editContent(c){contentChosen=c.id;const f=$('contentForm');for(const element of f.elements){if(!element.name)continue;element.value=c[element.name]??'';}message(`「${c.title}」を編集中です`);}
function newContent(){$('contentForm').reset();contentChosen=null;}
function renderRights(){const list=$('rightsList');list.replaceChildren();for(const p of detail.permissions){textNode(list,`${p.kind} / ${p.rights_holder} / ${p.revoked_at?'取消済み':p.expires_at||'期限未設定'} / 確認 ${p.confirmed_at}`,'record');}if(!detail.permissions.length)textNode(list,'掲載許諾はまだ登録されていません。','muted');}
function renderMetrics(){const m=detail.metrics||{};$('metrics').textContent=`直近30日・PV ${m.last30dPageviews||0} / 日別UU延べ数（IP推定） ${m.last30dVisitors||0} / コンテンツ遷移クリック ${m.last30dContentClicks||0} / 通常作品遷移クリック ${m.last30dNovelClicks||0}${m.metricsCapped?' ※集計上限に到達':''}`;const a=$('audit');a.replaceChildren();for(const x of detail.log||[]){
 const entry=textNode(a,`${new Date(x.created_at).toLocaleString('ja-JP')} ${x.operation}`,'record');
 if(x.restorable){
   const btn=document.createElement('button');
   btn.type='button';
   btn.textContent='以前の版へ復元';
   btn.style.marginLeft='12px';
   btn.onclick=()=>guard(async()=>{
     if(!confirm('以前の内容へ戻します。企画は一時停止、本文は下書きになります。再公開には掲載権利の確認が必要です。続けますか？'))return;
     await api('POST',{action:'restore',id:chosen,log_id:x.id});
     await open(chosen);
     message('以前の版へ戻しました。権利を確認してから再公開してください');
   });
   entry.append(btn);
 }
}}
function reset(){chosen=null;contentChosen=null;detail=null;$('rightsForm').reset();$('evidenceUploadStatus').textContent='';$('projectForm').reset();$('projectForm').elements.slug.readOnly=false;$('editorTitle').textContent='新規企画';for(const id of ['statusControl','rightsControl','contentForm'])$(id).classList.add('hidden');$('contentList').textContent='企画を選択してください。';}
async function guard(fn){try{await fn();}catch(error){message(error?.message||'操作に失敗しました',true)}}
$('clone').onclick=()=>guard(async()=>{if(!chosen)throw new Error('複製する企画を選択してください');const r=await api('POST',{action:'clone',id:chosen});await open(r.project.id);message('下書きとして複製しました。掲載権利は引き継がれません');});
$('preview').onclick=()=>{if(!detail)return;const box=$('previewBox');box.classList.toggle('hidden');if(box.classList.contains('hidden'))return;const p=detail.project;box.textContent=`【運営専用プレビュー／未許諾・未公開情報を含む】\n${p.title}\n作家：${p.author_name||'未設定'}\n対象作品：${p.work_title||'未設定'}\n${p.summary||''}\n${p.description||''}\n\n${detail.contents.map(c=>`${c.title} [${c.status}]\n${c.mode==='inline'?(c.body||''):c.mode==='episode'?'既存エピソードID:'+c.episode_id:(c.external_url||'')}`).join('\n\n')}`;};
$('new').onclick=()=>reset();$('reload').onclick=()=>guard(async()=>{await load();message('一覧を更新しました')});$('clearContent').onclick=()=>newContent();
$('projectForm').onsubmit=e=>{e.preventDefault();guard(async()=>{const x=formObject(e.target);for(const key of ['starts_at','ends_at'])x[key]=datify(x[key]);if(x.novel_id!==null)x.novel_id=Number(x.novel_id);if(x.sort_order!==null)x.sort_order=Number(x.sort_order);const r=await api('POST',{action:'save_project',id:chosen,project:x});if(!r)return;message('企画を保存しました（公開には別途権利確認が必要です）');await open(r.project.id);});};
$('contentForm').onsubmit=e=>{e.preventDefault();guard(async()=>{const x=formObject(e.target);x.sort_order=Number(x.sort_order||0);if(x.episode_id!==null)x.episode_id=Number(x.episode_id);await api('POST',{action:'save_content',id:chosen,content_id:contentChosen,content:x});message('コンテンツを保存しました。変更後は許諾を再確認してください');await open(chosen);});};
$('uploadEvidence').onclick=()=>guard(async()=>{
 if(!chosen)throw new Error('企画を先に保存してください');
 const file=$('evidenceFile').files?.[0];
 const allowed=['application/pdf','image/png','image/jpeg','image/webp'];
 if(!file||!allowed.includes(file.type)||file.size<1||file.size>10*1024*1024)
   throw new Error('証跡は10MB以内のPDF・PNG・JPEG・WebPを選択してください');
 const selected=chosen;
 $('evidenceUploadStatus').textContent='非公開ストレージへ送信しています';
 const ticket=await api('POST',{project_id:selected,mime_type:file.type,size:file.size},'/api/admin-special-evidence');
 if(!ticket)return;
 const {error}=await sb.storage.from(ticket.bucket)
   .uploadToSignedUrl(ticket.path,ticket.token,file,{contentType:file.type,upsert:false});
 if(error)throw error;
 if(chosen!==selected)throw new Error('企画が変更されたため、許諾登録の前に証跡を選び直してください');
 $('rightsForm').elements.evidence_reference.value=ticket.bucket+'/'+ticket.path;
 $('evidenceUploadStatus').textContent='非公開で保存済み。掲載許諾の確認を続けてください';
 message('証跡を保存しました。許諾確認ボタンを押すまで公開されません');
});
$('rightsForm').onsubmit=e=>{e.preventDefault();guard(async()=>{if(!$('approvalChecked').checked)throw new Error('掲載許諾の確認にチェックしてください');const x=formObject(e.target);for(const k of ['valid_from','expires_at'])x[k]=datify(x[k]);if(x.kind!=='content')x.content_id=null;if(x.kind==='content'&&!x.content_id)throw new Error('対象コンテンツを選択してください');await api('POST',{action:'approve',id:chosen,...x,confirm_text:'掲載権利を確認しました'});message('許諾記録を保存しました');await open(chosen);});};
$('revoke').onclick=()=>guard(async()=>{if(!confirm('企画全体の許諾を取り消します。公開中の表示が止まります。続けますか？'))return;await api('POST',{action:'revoke',id:chosen});await open(chosen);message('すべての許諾を取り消しました')});
$('emergency').onclick=()=>guard(async()=>{if(!confirm('緊急非公開にし、全許諾を取り消しますか？'))return;await api('POST',{action:'emergency_pause',id:chosen});await open(chosen);message('緊急非公開処理を実行しました')});
for(const button of document.querySelectorAll('[data-status]'))button.onclick=()=>guard(async()=>{if(!chosen)return;if(button.dataset.status==='published'&&!confirm('公開状態に変更します。掲載権利と内容を確認しましたか？'))return;await api('POST',{action:'set_status',id:chosen,status:button.dataset.status});await open(chosen);message('公開状態を更新しました')});
load().then(()=>{$('app').classList.remove('hidden');message('管理者認証で操作を開始できます')}).catch(error=>message(error?.message||'管理画面を開けません',true));