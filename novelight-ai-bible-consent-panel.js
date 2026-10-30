// Dormant owner-only consent panel; NO existing page imports this script.
// Displays disclosure from a trusted owner-verified API, never invented terms.
// Never sends a POST before a user click. Uses textContent, never innerHTML.
(function (root) {
  'use strict';

  const attached = new WeakSet();
  const pending = new WeakSet();
  const PROCESSORS = new Set(['openai', 'gemini']);

  function id(value) {
    if (!/^[1-9]\d*$/.test(String(value))) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  function bounded(text, max) {
    return typeof text === 'string' && text.length > 0 && text.length <= max;
  }

  function valid(data, novelId) {
    if (
      data?.novelId !== novelId ||
      data?.aiEnabled !== false ||
      !bounded(data.policyRevision, 120) ||
      !Array.isArray(data.disclosures) ||
      !data.disclosures.length ||
      data.disclosures.length > 2
    ) {
      return false;
    }
    const seen = new Set();
    return data.disclosures.every((entry) => {
      if (
        !PROCESSORS.has(entry?.processor) ||
        seen.has(entry.processor) ||
        !bounded(entry.label, 80) ||
        !bounded(entry.purpose, 240) ||
        !bounded(entry.dataSent, 800) ||
        !bounded(entry.retention, 800) ||
        !bounded(entry.internationalTransfer, 800) ||
        !['none', 'active', 'revoked'].includes(entry.status) ||
        (entry.status === 'active' &&
          !bounded(entry.expiresAt, 80)) ||
        (entry.status !== 'active' && entry.expiresAt !== null)
      ) {
        return false;
      }
      seen.add(entry.processor);
      return true;
    });
  }

  function sameSession(session, ownerId, token) {
    return (
      session?.user?.id === ownerId &&
      typeof session.access_token === 'string' &&
      session.access_token === token
    );
  }

  async function attach({
    client,
    ownerId,
    novelId,
    doc = root.document,
    fetcher = root.fetch
  } = {}) {
    const host = doc?.getElementById?.('main-content');
    const work = id(novelId);
    if (
      !host ||
      attached.has(host) ||
      pending.has(host) ||
      !work ||
      typeof ownerId !== 'string' ||
      typeof client?.auth?.getSession !== 'function' ||
      typeof client?.auth?.onAuthStateChange !== 'function' ||
      typeof fetcher !== 'function'
    ) {
      return false;
    }

    pending.add(host);
    let section = null;
    let subscription = null;
    let mounted = false;
    let disposed = false;
    let busy = false;

    function clear() {
      disposed = true;
      if (section) {
        section.textContent = '';
        section.remove();
      }
      subscription?.unsubscribe();
      if (mounted) attached.delete(host);
    }

    try {
      const first = await client.auth.getSession();
      const session = !first.error && first.data?.session;
      const token = session?.access_token;
      if (!sameSession(session, ownerId, token)) return false;

      async function current() {
        const next = await client.auth.getSession();
        return !next.error && sameSession(next.data?.session, ownerId, token);
      }

      const url = '/api/ai-owner-bible-consent?novel_id=' + work;
      async function fetchView() {
        const response = await fetcher(url, {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + token },
          credentials: 'same-origin',
          cache: 'no-store'
        });
        if (!response.ok) return null;
        const data = await response.json();
        return valid(data, work) ? data : null;
      }

      let data = await fetchView();
      if (!data || !(await current())) return false;

      section = doc.createElement('section');
      section.setAttribute(
        'aria-label',
        '外部AIによる作品カルテ解析の同意（管理人限定）'
      );
      const heading = doc.createElement('h3');
      heading.textContent = '外部AIへの作品送信の同意';
      section.appendChild(heading);
      const intro = doc.createElement('p');
      intro.textContent =
        'この操作ではAI解析は始まりません。事業者ごとに内容を確認し、必要な場合だけ同意できます。';
      section.appendChild(intro);
      const rows = doc.createElement('div');
      section.appendChild(rows);
      const status = doc.createElement('p');
      status.setAttribute('role', 'status');
      section.appendChild(status);

      function line(parent, text) {
        const element = doc.createElement('p');
        element.textContent = text;
        parent.appendChild(element);
      }

      function render(view) {
        rows.textContent = '';
        status.textContent = '';
        for (const item of view.disclosures) {
          const row = doc.createElement('div');
          line(row, item.label + '／' + item.purpose);
          line(row, '送信する内容：' + item.dataSent);
          line(row, '保存・削除：' + item.retention);
          line(row, '国外での処理：' + item.internationalTransfer);
          line(
            row,
            item.status === 'active'
              ? '同意中（期限：' + item.expiresAt + '）'
              : '現在の状態：' +
                  (item.status === 'revoked' ? '撤回済み' : '未同意')
          );

          const checkbox = doc.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = false;
          if (item.status !== 'active') {
            const label = doc.createElement('label');
            label.textContent =
              '上記の内容を確認し、この事業者への原稿送信に同意する';
            row.appendChild(label);
            row.appendChild(checkbox);
          }

          const button = doc.createElement('button');
          button.type = 'button';
          button.textContent =
            item.status === 'active' ? '同意を撤回' : '同意する';
          button.addEventListener('click', async () => {
            if (disposed || busy) return;
            const action = item.status === 'active' ? 'revoke' : 'grant';
            if (action === 'grant' && checkbox.checked !== true) return;
            busy = true;
            button.disabled = true;
            try {
              if (!(await current())) {
                clear();
                return;
              }
              const body =
                action === 'grant'
                  ? {
                      action,
                      processor: item.processor,
                      policyRevision: view.policyRevision,
                      acceptedExternalProcessing: true
                    }
                  : { action, processor: item.processor };
              const response = await fetcher(url, {
                method: 'POST',
                headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
                  'X-Novelight-Ai-Consent': '1'
                },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify(body)
              });
              if (!response.ok || !(await current())) {
                clear();
                return;
              }
              const receipt = await response.json();
              if (
                receipt?.novelId !== work ||
                receipt?.processor !== item.processor ||
                receipt?.status !==
                  (action === 'grant' ? 'granted' : 'revoked') ||
                receipt?.aiEnabled !== false
              ) {
                clear();
                return;
              }
              // Do not infer durable state from a response alone. Re-read the
              // server source of truth before presenting updated controls.
              const updated = await fetchView();
              if (
                !updated ||
                updated.policyRevision !== view.policyRevision ||
                !(await current())
              ) {
                clear();
                return;
              }
              data = updated;
              render(data);
              status.textContent =
                action === 'grant'
                  ? '同意を記録しました。AI解析はまだ無効です。'
                  : '同意を撤回しました。';
            } catch {
              clear();
            } finally {
              busy = false;
              button.disabled = false;
            }
          });
          row.appendChild(button);
          rows.appendChild(row);
        }
      }

      render(data);
      const listener = client.auth.onAuthStateChange((_event, next) => {
        if (!sameSession(next, ownerId, token)) clear();
      });
      subscription = listener?.data?.subscription;
      if (
        typeof subscription?.unsubscribe !== 'function' ||
        !(await current()) ||
        disposed
      ) {
        clear();
        return false;
      }
      host.appendChild(section);
      mounted = true;
      attached.add(host);
      return true;
    } catch {
      clear();
      return false;
    } finally {
      pending.delete(host);
    }
  }

  root.NovelightAiBibleConsentPanel = Object.freeze({ attach });
})(globalThis);
