import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,safeUrl,projectRightsDigest,coverRightsDigest,ogpRightsDigest,
  contentRightsDigest,projectIsVisible,permittedCover,permittedOgp,
  contentIsVisible,validateProject,validateContent,approvedDigest
} from '../api/_lib/special-core.js';

const now = new Date('2026-10-22T10:00:00.000Z');
const project = {
  id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  slug:'official-author-special', title:'許諾済み企画',kind:'ss',
  summary:'紹介文',description:'詳細文',author_name:'作家名',author_bio:'紹介',
  work_title:'作品名',work_description:'作品紹介',
  author_x_url:null,author_other_url:null,work_url:null,
  cover_url:null,ogp_url:null,novel_id:null,
  status:'published',starts_at:null,ends_at:null
};
const permit=(kind,digest,content_id=null)=>({
  kind,content_id,approved_digest:digest,
  confirmed_at:'2026-10-20T10:00:00.000Z',
  valid_from:null,expires_at:null,revoked_at:null
});
const rights=[permit('project',projectRightsDigest(project))];
const content={
  id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  title:'第一話',kind:'ss',mode:'episode',body:null,episode_id:12,
  external_url:null,status:'published'
};
test('未契約・無許諾の企画を公開しない',()=>{
  assert.equal(projectIsVisible(project,[],now),false);
});
test('許諾済みで公開状態なら表示できる',()=>{
  assert.equal(projectIsVisible(project,rights,now),true);
});
test('下書き・一時停止・終了状態では表示しない',()=>{
  for (const status of ['draft','pending','paused','ended'])
    assert.equal(projectIsVisible({...project,status},rights,now),false);
});
test('開始前・終了後は表示しない。期間未設定は許容する',()=>{
  assert.equal(projectIsVisible({...project,starts_at:'2026-11-01T00:00:00Z'},rights,now),false);
  assert.equal(projectIsVisible({...project,ends_at:'2026-10-01T00:00:00Z'},rights,now),false);
  assert.equal(projectIsVisible(project,rights,now),true);
});
test('権利の有効期限を過ぎたら非公開',()=>{
  const expired=[{...rights[0],expires_at:'2026-10-21T00:00:00Z'}];
  assert.equal(projectIsVisible(project,expired,now),false);
});
test('権利を取り消したら非公開',()=>{
  assert.equal(projectIsVisible(project,[{...rights[0],revoked_at:now.toISOString()}],now),false);
});
test('公開後に紹介文を差し替えたら以前の許諾は失効',()=>{
  assert.equal(projectIsVisible({...project,summary:'変更された文章'},rights,now),false);
});
test('カバー画像とOGP画像はそれぞれ権利許諾が必要',()=>{
  const withImages={...project,cover_url:'https://example.com/cover.png',
    ogp_url:'https://example.com/share.png'};
  assert.equal(permittedCover(withImages,rights,now),false);
  assert.equal(permittedOgp(withImages,rights,now),false);
  assert.equal(permittedCover(withImages,
    [...rights,permit('cover',coverRightsDigest(withImages))],now),true);
  assert.equal(permittedOgp(withImages,
    [...rights,permit('ogp',ogpRightsDigest(withImages))],now),true);
});
test('未許諾コンテンツは本文公開を拒否',()=>{
  assert.equal(contentIsVisible(content,rights,now),false);
  const right=permit('content',contentRightsDigest(content),content.id);
  assert.equal(contentIsVisible(content,[...rights,right],now),true);
  assert.equal(contentIsVisible({...content,title:'無断差替え'},[...rights,right],now),false);
});
test('既存リーダーの年齢確認が未統合の直接本文は許諾済みでも非公開',()=>{
  const inline={...content,mode:'inline',body:'安全導線未接続の本文',episode_id:null};
  const approval=permit('content',contentRightsDigest(inline),inline.id);
  assert.equal(contentIsVisible(inline,[approval],now),false);
});
test('別コンテンツの権利を流用できない',()=>{
  const right=permit('content',contentRightsDigest(content),'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.equal(contentIsVisible(content,[right],now),false);
});
test('権利確認対象は現行コンテンツに限る',()=>{
  assert.equal(approvedDigest(project,[content],'content',content.id),
    contentRightsDigest(content));
  assert.throws(()=>approvedDigest(project,[],'content',content.id));
});
test('HTML特殊文字をエスケープする',()=>{
  assert.equal(escapeHtml('<img src=x onerror="x">'),
    '&lt;img src=x onerror=&quot;x&quot;&gt;');
});
test('危険なURLを拒否する',()=>{
  assert.equal(safeUrl('javascript:alert(1)',{external:true}),'');
  assert.equal(safeUrl('http://example.com',{external:true}),'');
  assert.equal(safeUrl('https://example.com',{external:true}),'https://example.com/');
});
test('slugと日時の検証',()=>{
  assert.throws(()=>validateProject({...project,slug:'../admin'}));
  assert.throws(()=>validateProject({...project,starts_at:'2026-11-01',
    ends_at:'2026-10-01'}));
  assert.doesNotThrow(()=>validateProject({...project,starts_at:null,ends_at:null}));
});
test('コンテンツ形式の検証',()=>{
  assert.throws(()=>validateContent({...content,mode:'inline',body:''}));
  assert.throws(()=>validateContent({...content,mode:'external',
    external_url:'javascript:alert(1)'}));
  assert.doesNotThrow(()=>validateContent(content));
});
