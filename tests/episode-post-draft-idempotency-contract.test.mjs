import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../episode-post.html', import.meta.url), 'utf8');

test('episode post serializes first draft creation and persists the server draft id in history', () => {
  assert.ok(html.includes('draftSaveTail=Promise.resolve()'));
  assert.ok(
    html.includes(
      'draftSaveTail.catch(()=>{}).then(()=>persistDraftNow(values))',
    ),
  );
  assert.ok(html.includes("url.searchParams.set('draft_id',String(draftId))"));
  assert.ok(html.includes("history.replaceState(history.state,'',url)"));
});

test('episode post restores an explicit draft id instead of silently falling back to a new episode', () => {
  assert.ok(html.includes("queryParams.get('draft_id')"));
  assert.ok(
    html.includes(
      ".eq('id',requestedDraftId).eq('novel_id',novelId).eq('user_id',session.user.id).maybeSingle()",
    ),
  );
  assert.ok(
    html.includes(
      '指定した下書きを復元できませんでした。新しい話としては保存していません。',
    ),
  );
});

test('chapter inheritance alone does not force creation before opening structure management', () => {
  assert.ok(html.includes("select('episode_number,chapter_id')"));
  assert.ok(
    html.includes(
      'if(latest?.chapter_id!=null&&optionExists(latest.chapter_id))chapterSelect.value=String(latest.chapter_id)',
    ),
  );
  assert.ok(
    html.includes(
      'shouldPersist=Boolean(pendingDraftId||hasUserContent||chapterDirty)',
    ),
  );
});
