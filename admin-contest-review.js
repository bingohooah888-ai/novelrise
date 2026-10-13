(function initContestAdminReview(global) {
  'use strict';
  const doc = global.document;
  if (!doc || !global.supabase) return;
  const client = global.supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );
  const $ = (id) => doc.getElementById(id);
  let page = 1;
  let total = 0;
  let selected = null;
  let busy = false;
  let detailRequestId = 0;

  function status(message) { $('status').textContent = message; }

  function clearList(node) { node.replaceChildren(); }

  function item(node, label) {
    const li = doc.createElement('li');
    li.textContent = label;
    node.append(li);
  }

  async function request(method, query = '', body) {
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token) {
      throw new Error('管理者アカウントのログインが必要です。');
    }
    const res = await global.fetch(
      '/api/admin-contest-review' + query,
      {
        method,
        headers: {
          Authorization: 'Bearer ' + data.session.access_token,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        cache: 'no-store'
      }
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || 'API HTTP ' + res.status);
    return payload;
  }

  async function loadReaders() {
    if (busy) return;
    busy = true;
    status('読者一覧を確認中…');
    try {
      const payload = await request('GET', '?page=' + page + '&limit=20');
      total = payload.total;
      const tbody = $('readers');
      clearList(tbody);
      for (const row of payload.readers) {
        const tr = doc.createElement('tr');
        const values = [
          row.id, row.kind === 'account' ? '会員' : 'ゲスト',
          row.review_status,
          row.risk_codes?.length ? row.risk_codes.join(', ') : '検知なし',
          row.updated_at || '—'
        ];
        for (let i = 0; i < values.length; i += 1) {
          const td = doc.createElement('td');
          td.textContent = String(values[i] || '—');
          if (i === 3 && row.requires_manual_review) td.className = 'risk';
          tr.append(td);
        }
        const td = doc.createElement('td');
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = '証跡を表示';
        button.addEventListener('click', () => void showReader(row.id));
        td.append(button);
        tr.append(td);
        tbody.append(tr);
      }
      if (!payload.readers.length) {
        const tr = doc.createElement('tr');
        const td = doc.createElement('td');
        td.colSpan = 6;
        td.textContent = '対象読者はいません。';
        tr.append(td);
        tbody.append(tr);
      }
      $('paging').textContent = page + 'ページ目 / 全' + total + '件';
      $('previous').disabled = page <= 1;
      $('next').disabled = page * 20 >= total;
      $('contestState').textContent =
        '状態：' + payload.contest_status +
        (payload.public_visible ? ' / 公開' : ' / 非公開');
      $('workspace').hidden = false;
      status('一覧を更新しました。リスクは審査の候補であり、不正確定ではありません。');
    } catch (error) {
      status('管理画面を表示できません：' + error.message);
    } finally {
      busy = false;
    }
  }

  async function showReader(id, { preserveNote = false } = {}) {
    if (busy) return;
    const requestId = ++detailRequestId;
    const previousNote = preserveNote ? $('note').value : '';
    try {
      status('証跡を取得中…');
      const payload = await request(
        'GET', '?reader_id=' + encodeURIComponent(id)
      );
      if (requestId !== detailRequestId) return;
      selected = payload.reader;
      $('detail').hidden = false;
      $('readerInfo').textContent =
        selected.id + ' / ' + selected.kind +
        ' / 状態：' + selected.review_status +
        ' / 全ポイントは仮判定・賞金確定対象外';
      clearList($('riskSignals'));
      for (const code of payload.risk?.signal_codes || []) {
        item($('riskSignals'), code);
      }
      if (!payload.risk?.signal_codes?.length) {
        item($('riskSignals'), '現時点で検知なし（安全を保証するものではありません）');
      }
      $('riskMetrics').textContent = JSON.stringify(
        payload.risk?.metrics || {}, null, 2
      );
      clearList($('scores'));
      for (const score of payload.scores || []) {
        item(
          $('scores'),
          score.entry_id + ' / ' +
          score.qualified_episode_count + '話 / ' +
          score.points + 'pt / ' + score.review_status
        );
      }
      if (!payload.scores?.length) item($('scores'), '対象データなし');
      clearList($('audit'));
      for (const audit of payload.audit || []) {
        item(
          $('audit'),
          audit.created_at + ' / ' + audit.action +
          ' / 理由：' + (audit.reason_code || '—') +
          ' / 担当者：' + (audit.actor_user_id || '—') +
          ' / ' + JSON.stringify(audit.evidence_summary || {})
        );
      }
      if (!payload.audit?.length) item($('audit'), '履歴なし');
      $('note').value = previousNote;
      $('submit').disabled = !['provisional', 'review_hold', 'cleared'].includes(selected.review_status);
      status('証跡を取得しました。');
    } catch (error) {
      if (requestId !== detailRequestId) return;
      selected = null;
      $('detail').hidden = true;
      status('証跡を取得できません：' + error.message);
    }
  }

  async function saveReview() {
    if (!selected || busy) return;
    const readerId = selected.id;
    const expectedStatus = selected.review_status;
    if (!['provisional', 'review_hold', 'cleared'].includes(expectedStatus)) {
      status('この読者は審査操作の対象外です。');
      return;
    }
    const action = $('action').value;
    const reason = $('reason').value;
    const note = $('note').value.trim();
    if (note.length < 20 || note.length > 500) {
      status('調査内容を20～500文字で入力してください。');
      return;
    }
    if (action === 'clear' &&
        !['manual_evidence', 'appeal_review', 'false_positive'].includes(reason)) {
      status('確認済みにするには、証拠の確認か再審査・誤検知の理由を選択してください。');
      return;
    }
    if (action === 'clear' &&
        !global.confirm('確認済みに変更します。十分な根拠を確認しましたか？')) {
      return;
    }
    busy = true;
    $('submit').disabled = true;
    try {
      await request('POST', '', {
        action,
        reader_id: readerId,
        expected_status: expectedStatus,
        reason_code: reason,
        note
      });
      busy = false;
      await showReader(readerId);
      await loadReaders();
      status('審査結果を記録しました。');
    } catch (error) {
      busy = false;
      await showReader(readerId, { preserveNote: true });
      status('審査を保存できません：' + error.message + '。最新の審査状態と入力内容を確認してください。');
    } finally {
      busy = false;
      $('submit').disabled = Boolean(!selected || !['provisional', 'review_hold', 'cleared'].includes(selected.review_status));
    }
  }

  $('refresh').addEventListener('click', () => void loadReaders());
  $('previous').addEventListener('click', () => {
    if (page > 1) { page -= 1; void loadReaders(); }
  });
  $('next').addEventListener('click', () => {
    if (page * 20 < total) { page += 1; void loadReaders(); }
  });
  $('submit').addEventListener('click', () => void saveReview());
  void loadReaders();
})(window);
