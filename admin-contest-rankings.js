(function initContestRankingAdmin(global) {
  'use strict';
  const doc = global.document;
  if (!doc || !global.supabase) return;
  const client = global.supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );
  const $ = (id) => doc.getElementById(id);
  let data = null;
  let busy = false;
  let revision = 0;

  function status(text) { $('status').textContent = text; }

  function selected() {
    const slot = Number($('slot').value);
    return data?.slots?.find((entry) => entry.slot === slot) ?? null;
  }

  async function request(method, body) {
    const auth = await client.auth.getSession();
    if (auth.error || !auth.data?.session?.access_token) {
      throw new Error('管理者アカウントでのログインが必要です。');
    }
    const result = await global.fetch('/api/admin-contest-rankings', {
      method,
      headers: {
        Authorization: 'Bearer ' + auth.data.session.access_token,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok) throw new Error(payload.error || 'API ' + result.status);
    return payload;
  }

  function render() {
    const preview = selected();
    const ready = data?.admin_release_enabled === true &&
      data.contest_status === 'active' && data.public_visible === true &&
      preview?.status !== 'published';
    $('prepare').disabled = busy || !ready;
    $('publish').disabled = busy || !ready ||
      !preview?.available || preview.status !== 'draft';
    $('contestInfo').textContent =
      'コンテスト：' + (data?.contest_status || '—') +
      (data?.public_visible ? ' / 公開' : ' / 非公開') +
      (data?.admin_release_enabled ? ' / 運営発表操作ON' : ' / 運営発表操作OFF');
    $('slotStatus').textContent = preview?.available
      ? '状態：' + preview.status +
        ' / 対象：' + (preview.snapshot_id || '—') +
        ' / 更新：' + (preview.created_at || '—')
      : '順位の下書きはまだありません。';
    $('previewRows').replaceChildren();
    for (const entry of preview?.rows || []) {
      const tr = doc.createElement('tr');
      for (const value of [
        entry.rank, entry.entry_id, entry.points, entry.qualifying_readers
      ]) {
        const td = doc.createElement('td');
        td.textContent = String(value ?? '—');
        tr.append(td);
      }
      $('previewRows').append(tr);
    }
  }

  async function refresh() {
    if (busy) return;
    const token = ++revision;
    status('ランキングの非公開状態を確認中…');
    try {
      const result = await request('GET');
      if (token !== revision) return;
      data = result;
      $('workspace').hidden = false;
      render();
      status('最新状態を取得しました。');
    } catch (error) {
      if (token !== revision) return;
      data = null;
      $('workspace').hidden = true;
      status('管理用データを取得できません：' + error.message);
    }
  }

  async function operate(action) {
    if (busy) return;
    const snapshot = selected();
    const note = $('note').value.trim();
    if (!data?.admin_release_enabled || data.contest_status !== 'active' ||
        data.public_visible !== true) {
      status('コンテストの発表操作はまだ有効ではありません。');
      return;
    }
    if (note.length < 20 || note.length > 500) {
      status('審査理由を20～500文字で入力してください。');
      return;
    }
    if (action === 'publish') {
      if (!snapshot?.available || snapshot.status !== 'draft' ||
          $('confirm').value.trim() !== '発表承認') {
        status('下書きを選び、発表承認の文字を入力してください。');
        return;
      }
      if (!global.confirm('この順位を読者に公開します。最終確認しましたか？')) {
        return;
      }
    }
    const slot = Number($('slot').value);
    busy = true;
    $('prepare').disabled = true;
    $('publish').disabled = true;
    try {
      await request('POST', {
        action,
        slot,
        confirmation: action === 'publish' ? '発表承認' : '',
        expected_snapshot_id:
          action === 'publish' ? snapshot.snapshot_id : null,
        expected_checksum:
          action === 'publish' ? snapshot.checksum : null,
        note
      });
      busy = false;
      await refresh();
      if (action === 'publish') $('confirm').value = '';
      status(action === 'publish'
        ? '発表操作を監査記録へ保存しました。公開状態を確認してください。'
        : '下書き準備を監査記録へ保存しました。');
    } catch (error) {
      busy = false;
      await refresh();
      status('操作は受け付けられませんでした：' + error.message +
        '。証拠と最新順位を改めて確認してください。');
    } finally {
      busy = false;
      if (data) render();
    }
  }

  $('slot').addEventListener('change', render);
  $('refresh').addEventListener('click', () => void refresh());
  $('prepare').addEventListener('click', () => void operate('prepare'));
  $('publish').addEventListener('click', () => void operate('publish'));
  void refresh();
})(window);
