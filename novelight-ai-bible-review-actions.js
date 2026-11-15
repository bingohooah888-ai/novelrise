// An opt-in owner-only controller. Loaded only on private Story Notes,
// and never mounted without a successful owner-only review API response.
// Rendering is textContent-only; no HTML, model execution or auto-acceptance.
(function (root) {
  'use strict';

  const mountedReviews = new WeakMap();

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
      (item.replacesOutdatedVersion === undefined ||
        item.replacesOutdatedVersion === true) &&
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
    const stale = payload.staleCandidates ?? [];
    if (
      !Array.isArray(stale) ||
      stale.length > 200 ||
      !stale.every(
        (item) =>
          ['pending', 'accepted'].includes(item?.status) &&
          ['source_changed', 'episode_missing'].includes(item?.staleReason) &&
          validItem(item, item.status) &&
          item.replacesOutdatedVersion === undefined
      )
    ) {
      return false;
    }
    const ids = [...payload.candidates, ...accepted, ...stale].map((item) =>
      positive(item.id)
    );
    const pagination = payload.pagination;
    if (pagination !== undefined) {
      if (
        !pagination ||
        typeof pagination !== 'object' ||
        Array.isArray(pagination) ||
        Object.keys(pagination).length !== 1 ||
        (pagination.nextBeforeId !== null &&
          !positive(pagination.nextBeforeId)) ||
        ids.length > 25 ||
        (pagination.nextBeforeId !== null &&
          (!ids.length || pagination.nextBeforeId !== Math.min(...ids)))
      ) {
        return false;
      }
    }
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
    onAccepted,
    replaceExisting = null
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
    const previous = mountedReviews.get(host);
    if (previous && previous !== replaceExisting) {
      return (
        previous.client === client &&
        previous.ownerId === ownerId &&
        previous.novelId === id &&
        previous.fetcher === fetcher &&
        (await previous.currentSession())
      );
    }
    if (previous && !previous.canReplace()) return false;
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
    async function getCandidates(beforeId = null) {
      const pageUrl = beforeId === null ? url : url + '&before_id=' + beforeId;
      const response = await fetcher(pageUrl, {
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
      if (mountedReviews.get(host)?.section === section) {
        mountedReviews.delete(host);
      }
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
          // The list may have become stale while the page was open. Ask the
          // owner-only API to reload the accepted row and current chapter
          // BEFORE preparing an editable draft. No transfer on failures.
          if (
            typeof onAccepted !== 'function' ||
            item.status !== 'accepted' ||
            !Number.isSafeInteger(item.revision) ||
            item.revision < 2
          ) {
            throw new Error('TRANSFER_NOT_VERIFIED');
          }
          const recheckUrl =
            url +
            '&transfer_candidate_id=' +
            item.id +
            '&expected_revision=' +
            item.revision;
          const response = await fetcher(recheckUrl, {
            method: 'GET',
            headers: { Authorization: 'Bearer ' + token },
            credentials: 'same-origin',
            cache: 'no-store'
          });
          if (!response.ok || !(await currentSession())) {
            throw new Error('TRANSFER_NOT_VERIFIED');
          }
          const verified = await response.json();
          const current = verified?.candidate;
          if (
            verified?.novelId !== id ||
            verified?.transferReady !== true ||
            !validItem(current, 'accepted') ||
            current.id !== item.id ||
            current.revision !== item.revision ||
            current.episodeId !== item.episodeId ||
            current.kind !== item.kind ||
            current.key !== item.key ||
            current.summary !== item.summary ||
            current.evidence !== item.evidence ||
            current.replacesOutdatedVersion !== undefined ||
            !(await currentSession())
          ) {
            throw new Error('TRANSFER_NOT_VERIFIED');
          }
          // Use only server-revalidated data, never the prior list snapshot.
          // This fills an UNSAVED draft; saving remains a separate author act.
          const prepared = await onAccepted({
            kind: current.kind,
            key: current.key,
            summary: current.summary,
            evidence: current.evidence,
            episodeId: current.episodeId
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
            list.appendChild(
              offerTransfer({
                ...item,
                status: 'accepted',
                revision: updated.revision
              })
            );
          }
        } catch {
          decisionUnconfirmed();
        } finally {
          busy = false;
        }
      });
      return element;
    }

    // Render only one validated, owner-scoped page per explicit author click.
    // The same ID may never appear twice, even if another review changes
    // status during paging. The server owns ordering and stale decisions.
    const seenIds = new Set();
    function appendPage(page) {
      for (const item of page.candidates) {
        const row = doc.createElement('div');
        const details = doc.createElement('p');
        details.textContent =
          (item.replacesOutdatedVersion ? '【改稿後の新版候補】' : '') +
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
      if (!page.candidates.length && page === data) {
        list.textContent = '保留中の候補はありません。';
      }
      // Previously reviewed candidates are still recoverable after reload,
      // but neither listing nor transfer changes the author's canonical notes.
      if (page.acceptedCandidates?.length && typeof onAccepted === 'function') {
        const heading = doc.createElement('p');
        heading.textContent =
          '確認済み候補（まだ創作ノートへ保存していない場合は転記できます）';
        list.appendChild(heading);
        for (const item of page.acceptedCandidates) {
          const row = doc.createElement('div');
          const details = doc.createElement('p');
          details.textContent =
            (item.replacesOutdatedVersion ? '【改稿後の新版候補】' : '') +
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
      // Stale rows are historical candidate records, not reviewable canon.
      // Render as text only; never offer accept/reject or note-transfer actions.
      if (page.staleCandidates?.length) {
        const heading = doc.createElement('p');
        heading.textContent =
          '改稿前のAI候補（過去の版・操作不可。再解析で確認してください）';
        list.appendChild(heading);
        for (const item of page.staleCandidates) {
          const row = doc.createElement('div');
          const details = doc.createElement('p');
          details.textContent =
            (item.status === 'accepted' ? '過去に確認済み' : '未確認') +
            '／' +
            item.kind +
            '：' +
            item.key +
            '／参照エピソードID：' +
            item.episodeId +
            '／旧版の候補：' +
            item.summary +
            '／旧版の本文根拠：' +
            item.evidence +
            (item.staleReason === 'episode_missing'
              ? '／参照話が見つかりません'
              : '／本文が変更されています');
          row.appendChild(details);
          list.appendChild(row);
        }
      }
    }
    function pageIds(page) {
      return [
        ...page.candidates,
        ...(page.acceptedCandidates ?? []),
        ...(page.staleCandidates ?? [])
      ].map((item) => item.id);
    }
    function allowPage(page, requestedBeforeId = null) {
      if (!validResponse(page, id)) return false;
      const ids = pageIds(page);
      if (
        ids.some(
          (itemId) =>
            seenIds.has(itemId) ||
            (requestedBeforeId !== null && itemId >= requestedBeforeId)
        ) ||
        (requestedBeforeId !== null &&
          page.pagination === undefined) ||
        (requestedBeforeId !== null &&
          page.pagination.nextBeforeId !== null &&
          page.pagination.nextBeforeId >= requestedBeforeId)
      ) {
        return false;
      }
      for (const itemId of ids) seenIds.add(itemId);
      return true;
    }
    if (!allowPage(data)) return false;
    appendPage(data);

    if (data.pagination) {
      const pager = doc.createElement('div');
      const showNext = doc.createElement('button');
      showNext.type = 'button';
      showNext.textContent = 'さらに古い候補を25件表示';
      let nextBeforeId = data.pagination.nextBeforeId;
      showNext.hidden = nextBeforeId === null;
      showNext.addEventListener('click', async () => {
        if (disposed || busy || nextBeforeId === null) return;
        busy = true;
        const requestedBeforeId = nextBeforeId;
        try {
          if (!(await currentSession())) {
            clear();
            return;
          }
          const page = await getCandidates(requestedBeforeId);
          if (!(await currentSession())) {
            clear();
            return;
          }
          if (!page || !allowPage(page, requestedBeforeId)) {
            nextBeforeId = null;
            showNext.hidden = true;
            reviewNotice.textContent =
              '続きを確認できませんでした。ページを再読み込みしてください。';
            return;
          }
          appendPage(page);
          nextBeforeId = page.pagination.nextBeforeId;
          showNext.hidden = nextBeforeId === null;
        } catch {
          nextBeforeId = null;
          showNext.hidden = true;
          reviewNotice.textContent =
            '続きを取得できませんでした。ページを再読み込みしてください。';
        } finally {
          busy = false;
        }
      });
      pager.appendChild(showNext);
      section.appendChild(pager);
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
    if (previous && !previous.canReplace()) return false;
    // Swap the previous private list only after owner-scoped GET and session
    // validation. A replacement never mutates candidate decisions or canon.
    if (previous) previous.clear();
    host.appendChild(section);
    mountedReviews.set(host, {
      section,
      client,
      ownerId,
      novelId: id,
      fetcher,
      onAccepted,
      currentSession,
      canReplace: () => !disposed && !busy,
      clear
    });
    return true;
  }

  // A read-only refresh preserves the existing accepted-draft callback.
  // null = no view mounted, false = refresh denied; never render stale rows
  // as if they were freshly fetched.
  async function refresh({ client, ownerId, novelId, doc = root.document } = {}) {
    const host = doc?.getElementById?.('main-content');
    const previous = mountedReviews.get(host);
    if (!previous) return null;
    if (
      previous.client !== client ||
      previous.ownerId !== ownerId ||
      previous.novelId !== positive(novelId) ||
      !previous.canReplace()
    ) return false;
    let updated = false;
    try {
      updated = await attach({
        client,
        ownerId,
        novelId,
        doc,
        fetcher: previous.fetcher,
        onAccepted: previous.onAccepted,
        replaceExisting: previous
      });
    } catch {
      updated = false;
    }
    if (!updated) previous.clear();
    return updated;
  }

  root.NovelightAiBibleReviewActions = Object.freeze({ attach, refresh });
})(globalThis);
