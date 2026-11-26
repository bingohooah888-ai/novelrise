// An opt-in owner-only controller. Loaded only on private Story Notes,
// and never mounted without a successful owner-only review API response.
// Rendering is textContent-only; no HTML, model execution or auto-acceptance.
(function (root) {
  'use strict';

  const FACT_KINDS = new Set([
    'character',
    'relationship',
    'location',
    'world',
    'timeline',
    'event',
    'foreshadowing',
    'other'
  ]);

  function positive(value) {
    const text = String(value);
    if (!/^[1-9]\d*$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) ? number : null;
  }

  function validItem(item, status = 'pending') {
    return (
      positive(item?.id) &&
      positive(item?.episodeId) &&
      Number.isSafeInteger(item?.revision) &&
      item.revision >= (status === 'accepted' ? 2 : 1) &&
      item.status === status &&
      FACT_KINDS.has(item.kind) &&
      typeof item.key === 'string' &&
      item.key.trim().length > 0 &&
      item.key.length <= 120 &&
      typeof item.summary === 'string' &&
      item.summary.trim().length > 0 &&
      item.summary.length <= 320 &&
      typeof item.evidence === 'string' &&
      item.evidence.trim().length > 0 &&
      item.evidence.length <= 160
    );
  }

  // Separate from the preview grouped-facts contract; reject mixed,
  // duplicated or unscoped candidates before exposing review controls.
  function validResponse(payload, novelId) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      payload.novelId !== novelId ||
      payload.aiGenerated !== false ||
      !Array.isArray(payload.candidates) ||
      payload.candidates.length > 100 ||
      !payload.candidates.every((item) => validItem(item))
    )
      return false;
    const accepted = payload.acceptedCandidates ?? [];
    if (
      !Array.isArray(accepted) ||
      accepted.length > 100 ||
      !accepted.every((item) => validItem(item, 'accepted'))
    ) {
      return false;
    }
    const ids = [...payload.candidates, ...accepted].map((item) =>
      positive(item.id)
    );
    return new Set(ids).size === ids.length;
  }

  // Explicit invocation from an owner-verified author surface only. The API
  // reauthenticates owner/work for every GET and POST.
  async function attach({
    client,
    ownerId,
    novelId,
    doc = root.document,
    fetcher = root.fetch,
    onAccepted
  } = {}) {
    const host = doc?.getElementById?.('main-content');
    const id = positive(novelId);
    if (
      !host ||
      !id ||
      typeof ownerId !== 'string' ||
      typeof client?.auth?.getSession !== 'function' ||
      typeof client?.auth?.onAuthStateChange !== 'function' ||
      typeof fetcher !== 'function'
    ) {
      return false;
    }
    const first = await client.auth.getSession();
    const session = !first.error && first.data?.session;
    const token = session?.access_token;
    if (session?.user?.id !== ownerId || typeof token !== 'string' || !token) {
      return false;
    }
    const url = '/api/ai-owner-bible-review?novel_id=' + id;
    async function currentSession() {
      const next = await client.auth.getSession();
      return (
        !next.error &&
        next.data?.session?.user?.id === ownerId &&
        next.data?.session?.access_token === token
      );
    }
    async function getCandidates() {
      const response = await fetcher(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) return null;
      const result = await response.json();
      return validResponse(result, id) ? result : null;
    }
    let data;
    try {
      data = await getCandidates();
      if (!data || !(await currentSession())) return false;
    } catch {
      return false;
    }
    const section = doc.createElement('section');
    const title = doc.createElement('h3');
    title.textContent = '作品カルテ・AI候補の確認（管理人限定）';
    section.appendChild(title);
    const list = doc.createElement('div');
    section.appendChild(list);
    const reviewNotice = doc.createElement('p');
    reviewNotice.textContent =
      'AI候補の「採用」は確認記録です。正式な人物台帳・創作ノートには自動反映されません。';
    section.appendChild(reviewNotice);
    let disposed = false;
    let busy = false;
    let subscription;

    function clear() {
      disposed = true;
      list.textContent = '';
      section.remove();
      subscription?.unsubscribe();
    }

    // A failed/ambiguous POST must never look like an accepted candidate.
    // Hide unpublished candidate details, keep only a fixed neutral notice,
    // and require a reload rather than automatically retrying a decision.
    function decisionUnconfirmed() {
      disposed = true;
      list.textContent =
        '採用結果を確認できませんでした。ページを再読み込みしてください。';
    }

    function offerTransfer(item) {
      const transfer = doc.createElement('div');
      const transferButton = doc.createElement('button');
      transferButton.type = 'button';
      transferButton.textContent = '創作ノートに転記して編集（保存は別途）';
      transferButton.addEventListener('click', async () => {
        if (disposed || busy) return;
        busy = true;
        try {
          if (!(await currentSession())) {
            clear();
            return;
          }
          // This is only an editable draft; the author explicitly saves
          // through the existing owner-verified Story Notes RPC separately.
          const prepared = await onAccepted({
            kind: item.kind,
            key: item.key,
            summary: item.summary,
            evidence: item.evidence,
            episodeId: item.episodeId
          });
          if (!(await currentSession())) {
            clear();
            return;
          }
          if (prepared === true) {
            reviewNotice.textContent =
              '創作ノートの編集欄に転記しました。内容を確認して「保存」を押してください。';
            transfer.remove();
          } else {
            reviewNotice.textContent =
              '転記しませんでした。編集内容とログイン状態を確認してください。';
          }
        } catch {
          reviewNotice.textContent =
            '転記できませんでした。再度操作する前に編集内容を確認してください。';
        } finally {
          busy = false;
        }
      });
      transfer.appendChild(transferButton);
      return transfer;
    }

    function button(label, action, item, row) {
      const element = doc.createElement('button');
      element.type = 'button';
      element.textContent = label;
      element.addEventListener('click', async () => {
        if (disposed || busy) return;
        busy = true;
        try {
          if (!(await currentSession())) {
            clear();
            return;
          }
          const response = await fetcher(url, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
              'X-Novelight-Review': '1'
            },
            credentials: 'same-origin',
            cache: 'no-store',
            body: JSON.stringify({
              candidateId: item.id,
              expectedRevision: item.revision,
              action
            })
          });
          if (!(await currentSession())) {
            clear();
            return;
          }
          if (!response.ok) {
            decisionUnconfirmed();
            return;
          }
          const updated = await response.json();
          if (
            updated?.candidateId !== item.id ||
            updated?.novelId !== id ||
            updated?.status !==
              (action === 'accept' ? 'accepted' : 'rejected') ||
            updated?.canonModified !== false ||
            updated?.revision !== item.revision + 1
          ) {
            decisionUnconfirmed();
            return;
          }
          // Accepted is only a reviewed candidate, never author canon.
          reviewNotice.textContent =
            action === 'accept'
              ? '候補を確認済みにしました。正式設定は作者が別途編集してください。'
              : '候補を却下しました。';
          // Never perform a second POST automatically.
          row.remove();
          if (action === 'accept' && typeof onAccepted === 'function') {
            list.appendChild(offerTransfer(item));
          }
        } catch {
          decisionUnconfirmed();
        } finally {
          busy = false;
        }
      });
      return element;
    }

    for (const item of data.candidates) {
      const row = doc.createElement('div');
      const details = doc.createElement('p');
      details.textContent =
        item.kind +
        '：' +
        item.key +
        '／参照エピソードID：' +
        item.episodeId +
        '／候補：' +
        item.summary +
        '／本文根拠：' +
        item.evidence;
      row.appendChild(details);
      row.appendChild(
        button('候補を確認済みにする（正式設定は未変更）', 'accept', item, row)
      );
      row.appendChild(button('却下', 'reject', item, row));
      list.appendChild(row);
    }
    if (!data.candidates.length) {
      list.textContent = '保留中の候補はありません。';
    }
    // Previously reviewed candidates are still recoverable after reload,
    // but neither listing nor transfer changes the author's canonical notes.
    if (data.acceptedCandidates?.length && typeof onAccepted === 'function') {
      const heading = doc.createElement('p');
      heading.textContent =
        '確認済み候補（まだ創作ノートへ保存していない場合は転記できます）';
      list.appendChild(heading);
      for (const item of data.acceptedCandidates) {
        const row = doc.createElement('div');
        const details = doc.createElement('p');
        details.textContent =
          item.kind +
          '：' +
          item.key +
          '／参照エピソードID：' +
          item.episodeId +
          '／確認済み候補：' +
          item.summary +
          '／本文根拠：' +
          item.evidence;
        row.appendChild(details);
        row.appendChild(offerTransfer(item));
        list.appendChild(row);
      }
    }
    const listener = client.auth.onAuthStateChange((_event, next) => {
      if (next?.user?.id !== ownerId || next?.access_token !== token) {
        clear();
      }
    });
    subscription = listener?.data?.subscription;
    if (
      typeof subscription?.unsubscribe !== 'function' ||
      !(await currentSession()) ||
      disposed
    ) {
      clear();
      return false;
    }
    host.appendChild(section);
    return true;
  }

  root.NovelightAiBibleReviewActions = Object.freeze({ attach });
})(globalThis);
