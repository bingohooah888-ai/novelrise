(function initContestOperations(global) {
  'use strict';
  const doc = global.document;
  if (!doc || !global.supabase) return;
  const client = global.supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );
  const $ = (id) => doc.getElementById(id);
  const number = new Intl.NumberFormat('ja-JP');
  let page = 1;
  let requestId = 0;
  let loading = false;

  function status(value) {
    $('status').textContent = value;
  }

  function textCell(row, value, className) {
    const cell = doc.createElement('td');
    cell.textContent = String(value ?? '—');
    if (className) cell.className = className;
    row.append(cell);
  }

  async function request() {
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token) {
      throw new Error('管理者アカウントでログインしてください。');
    }
    const params = new URLSearchParams({
      page: String(page),
      limit: '20',
      status: $('filter').value
    });
    const response = await global.fetch('/api/admin-contest-operations?' + params, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + data.session.access_token },
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error || '管理データを取得できませんでした。');
    }
    return payload;
  }

  function render(payload) {
    const metrics = [
      ['entered', 'entered'],
      ['reviewHold', 'review_hold_readers'],
      ['awardPending', 'awards_pending'],
      ['awardHold', 'awards_on_hold'],
      ['awardApproved', 'awards_approved'],
      ['awardPaid', 'awards_paid']
    ];
    for (const [id, key] of metrics) {
      $(id).textContent = number.format(payload.summary?.[key] ?? 0);
    }
    $('contestStatus').textContent =
      '開催状態：' + (payload.contest_status || '不明') +
      (payload.public_visible ? ' / 公開' : ' / 非公開') +
      ' / 暫定ポイント・受賞未確定';

    const entries = $('entries');
    entries.replaceChildren();
    for (const entry of payload.entries || []) {
      const row = doc.createElement('tr');
      textCell(row, entry.novel_title_snapshot || '無題', 'title');
      textCell(row, entry.status);
      textCell(row, number.format(entry.provisional_points ?? 0));
      textCell(row, number.format(entry.qualifying_readers ?? 0));
      textCell(row, entry.award_status === 'not_assigned'
        ? '未確定' : entry.award_status);
      textCell(row, entry.final_rank);
      textCell(row, entry.paid_at);
      entries.append(row);
    }
    if (!(payload.entries || []).length) {
      const row = doc.createElement('tr');
      const cell = doc.createElement('td');
      cell.colSpan = 7;
      cell.textContent = '該当する応募作品はありません。';
      row.append(cell);
      entries.append(row);
    }

    const count = Number(payload.total || 0);
    $('paging').textContent = page + 'ページ目 / 全' + number.format(count) + '作品';
    $('previous').disabled = page <= 1;
    $('next').disabled = page * 20 >= count || page >= 101;

    const audit = $('audit');
    audit.replaceChildren();
    for (const event of payload.audit || []) {
      const item = doc.createElement('li');
      item.textContent = [
        event.created_at || '日時不明',
        event.action || '操作不明',
        '理由：' + (event.reason_code || '—')
      ].join(' / ');
      audit.append(item);
    }
    if (!(payload.audit || []).length) {
      const item = doc.createElement('li');
      item.textContent = '監査記録はまだありません。';
      audit.append(item);
    }
    $('workspace').hidden = false;
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    const current = ++requestId;
    $('refresh').disabled = true;
    status('運営情報を取得しています…');
    try {
      const data = await request();
      if (current !== requestId) return;
      render(data);
      status('最新の管理情報を取得しました。操作・振込は行っていません。');
    } catch (error) {
      if (current !== requestId) return;
      $('workspace').hidden = true;
      status('取得できませんでした：' + error.message);
    } finally {
      loading = false;
      $('refresh').disabled = false;
    }
  }

  $('filter').addEventListener('change', () => {
    page = 1;
    void refresh();
  });
  $('refresh').addEventListener('click', () => void refresh());
  $('previous').addEventListener('click', () => {
    if (page > 1) {
      page -= 1;
      void refresh();
    }
  });
  $('next').addEventListener('click', () => {
    if (!$('next').disabled && page < 101) {
      page += 1;
      void refresh();
    }
  });
  void refresh();
})(window);
