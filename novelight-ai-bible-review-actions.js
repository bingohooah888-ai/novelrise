// An opt-in owner-only controller. Deliberately NOT loaded by any page yet.
// Rendering is textContent-only; no HTML, model execution or auto-acceptance.
(function (root) {
  'use strict';

  function positive(value) {
    const text = String(value);
    if (!/^[1-9]\d*$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) ? number : null;
  }

  function validItem(item) {
    return (
      positive(item?.id) &&
      positive(item?.episodeId) &&
      Number.isSafeInteger(item?.revision) &&
      item.revision > 0 &&
      item.status === 'pending' &&
      typeof item.kind === 'string' &&
      item.kind.length <= 32 &&
      typeof item.key === 'string' &&
      item.key.length <= 120 &&
      typeof item.summary === 'string' &&
      item.summary.length <= 320 &&
      typeof item.evidence === 'string' &&
      item.evidence.length <= 160
    );
  }

  function validResponse(payload, novelId) {
    return (
      payload?.novelId === novelId &&
      Array.isArray(payload.candidates) &&
      payload.candidates.length <= 100 &&
      payload.candidates.every(validItem)
    );
  }

  // Explicit invocation from an owner-verified author surface only. The API
  // reauthenticates owner/work for every GET and POST.
  async function attach({
    client,
    ownerId,
    novelId,
    doc = root.document,
    fetcher = root.fetch
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
    if (
      session?.user?.id !== ownerId ||
      typeof token !== 'string' ||
      !token
    ) {
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
    let disposed = false;
    let busy = false;
    let subscription;

    function clear() {
      disposed = true;
      list.textContent = '';
      section.remove();
      subscription?.unsubscribe();
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
          if (!response.ok || !(await currentSession())) {
            clear();
            return;
          }
          const updated = await response.json();
          if (
            updated?.candidateId !== item.id ||
            updated?.novelId !== id ||
            updated?.status !==
              (action === 'accept' ? 'accepted' : 'rejected') ||
            updated?.canonModified !== false
          ) {
            clear();
            return;
          }
          // Never perform a second POST automatically.
          row.remove();
        } catch {
          clear();
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
        '／第' +
        item.episodeId +
        '話／候補：' +
        item.summary +
        '／本文根拠：' +
        item.evidence;
      row.appendChild(details);
      row.appendChild(button('採用（要確認）', 'accept', item, row));
      row.appendChild(button('却下', 'reject', item, row));
      list.appendChild(row);
    }
    if (!data.candidates.length) {
      list.textContent = '保留中の候補はありません。';
    }
    const listener = client.auth.onAuthStateChange((_event, next) => {
      if (
        next?.user?.id !== ownerId ||
        next?.access_token !== token
      ) {
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
