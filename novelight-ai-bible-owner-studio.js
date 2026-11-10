// Safely attaches the existing Novel Bible read-only view to private story notes.
// No DOM or navigation element is added unless the owner-authenticated API
// returns success; the API/AI feature is disabled by default server-side.
(function (root) {
  'use strict';

  const attached = new WeakSet();
  const pending = new WeakSet();

  function sameOwner(session, ownerId, initialToken) {
    return (
      session?.user?.id === ownerId &&
      typeof session.access_token === 'string' &&
      session.access_token === initialToken
    );
  }

  async function attach({
    client,
    novelId,
    ownerId,
    doc = root.document,
    panel = root.NovelightAiBibleOwnerPanel,
    fetcher = root.fetch,
    readOutline
  } = {}) {
    const host = doc?.getElementById?.('main-content');
    if (
      !host ||
      attached.has(host) ||
      pending.has(host) ||
      !client?.auth?.getSession ||
      !client?.auth?.onAuthStateChange ||
      typeof ownerId !== 'string' ||
      !ownerId ||
      (typeof panel?.createOfflineReader !== 'function' &&
        typeof panel?.mount !== 'function') ||
      (typeof panel?.createOfflineReader === 'function' &&
        typeof fetcher !== 'function') ||
      (readOutline !== undefined &&
        (typeof readOutline !== 'function' ||
          typeof panel?.createOfflineReader !== 'function'))
    ) {
      return false;
    }
    pending.add(host);
    let reader = null;
    let section = null;
    let content = null;
    let subscription = null;
    let disposed = false;
    let mounted = false;

    function clear() {
      if (disposed) return;
      disposed = true;
      reader?.dispose();
      if (content) content.textContent = '';
      section?.remove();
      subscription?.unsubscribe();
      if (mounted) attached.delete(host);
    }

    try {
      const first = await client.auth.getSession();
      const session = !first.error && first.data?.session;
      if (!sameOwner(session, ownerId, session?.access_token)) return false;

      // Construct off-DOM so no private source data appears before every
      // server-side owner check AND the final local session recheck succeed.
      section = doc.createElement('section');
      section.className = 'panel novelight-ai-bible-owner-section';
      section.setAttribute('aria-label', '作品カルテ（管理人限定・非公開）');
      content = doc.createElement('div');
      content.className = 'novelight-ai-bible-owner-content';
      content.hidden = true;
      section.appendChild(content);

      let allowed = false;
      if (typeof panel.createOfflineReader === 'function') {
        // Use the existing server-side administrator/owner preview endpoint.
        // The route is 404 unless its explicit server-side gate is enabled.
        // The client ownerId is only an additional session check, never an
        // authorization grant or a substitute for the server owner check.
        reader = panel.createOfflineReader({
          target: content,
          novelId,
          doc,
          readPreview: async ({ novelId: requestedNovelId }) => {
            if (disposed) throw new Error('SESSION_ENDED');
            const before = await client.auth.getSession();
            if (
              before.error ||
              !sameOwner(before.data?.session, ownerId, session.access_token)
            )
              throw new Error('SESSION_CHANGED');
            const response = await fetcher(
              '/api/ai-owner-novel-bible?novel_id=' +
                encodeURIComponent(requestedNovelId),
              {
                method: 'GET',
                headers: { Authorization: 'Bearer ' + session.access_token },
                cache: 'no-store',
                credentials: 'same-origin'
              }
            );
            if (!response?.ok) throw new Error('PREVIEW_DENIED');
            const payload = await response.json();
            const after = await client.auth.getSession();
            if (
              disposed ||
              after.error ||
              !sameOwner(after.data?.session, ownerId, session.access_token)
            )
              throw new Error('SESSION_CHANGED');
            return payload;
          },
          // Offline injection only. Production story-notes does not pass a
          // reader, and this controller never fetches private outline data.
          // A future server implementation must independently authorize the
          // requested work/session before supplying chapter navigation.
          readOutline:
            readOutline === undefined
              ? undefined
              : async ({ novelId: requestedNovelId, preview }) => {
                  if (disposed) throw new Error('SESSION_ENDED');
                  const before = await client.auth.getSession();
                  if (
                    before.error ||
                    !sameOwner(
                      before.data?.session,
                      ownerId,
                      session.access_token
                    )
                  )
                    throw new Error('SESSION_CHANGED');
                  const rows = await readOutline({
                    novelId: requestedNovelId,
                    preview
                  });
                  const after = await client.auth.getSession();
                  if (
                    disposed ||
                    after.error ||
                    !sameOwner(
                      after.data?.session,
                      ownerId,
                      session.access_token
                    )
                  )
                    throw new Error('SESSION_CHANGED');
                  return rows;
                }
        });
        allowed = reader ? await reader.reload() : false;
      } else {
        // Preserve the older one-shot prototype contract for existing tests.
        allowed = await panel.mount({ target: content, client, novelId });
      }
      if (!allowed || content.hidden || disposed) {
        clear();
        return false;
      }
      const second = await client.auth.getSession();
      if (
        second.error ||
        !sameOwner(second.data?.session, ownerId, session.access_token)
      ) {
        clear();
        return false;
      }

      const listener = client.auth.onAuthStateChange((_event, nextSession) => {
        if (!sameOwner(nextSession, ownerId, session.access_token)) clear();
      });
      subscription = listener?.data?.subscription;
      if (typeof subscription?.unsubscribe !== 'function' || disposed) {
        clear();
        return false;
      }
      // Recheck once more after subscribing, preventing a session change
      // during listener setup from exposing an old owner's notes.
      const third = await client.auth.getSession();
      if (
        third.error ||
        !sameOwner(third.data?.session, ownerId, session.access_token)
      ) {
        clear();
        return false;
      }
      host.appendChild(section);
      attached.add(host);
      mounted = true;
      return true;
    } catch {
      clear();
      return false;
    } finally {
      pending.delete(host);
    }
  }

  root.NovelightAiBibleOwnerStudio = Object.freeze({ attach });
})(globalThis);
