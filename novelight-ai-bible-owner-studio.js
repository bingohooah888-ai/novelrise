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
    panel = root.NovelightAiBibleOwnerPanel
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
      typeof panel?.mount !== 'function'
    ) {
      return false;
    }
    pending.add(host);
    try {
      const first = await client.auth.getSession();
      const session = !first.error && first.data?.session;
      if (!sameOwner(session, ownerId, session?.access_token)) return false;

      // Construct off-DOM so no private source data appears before every
      // server-side owner check AND the final local session recheck succeed.
      const section = doc.createElement('section');
      section.className = 'panel novelight-ai-bible-owner-section';
      section.setAttribute('aria-label', '作品カルテ（管理人限定・非公開）');
      const content = doc.createElement('pre');
      content.className = 'novelight-ai-bible-owner-content';
      content.hidden = true;
      section.appendChild(content);

      const allowed = await panel.mount({
        target: content,
        client,
        novelId
      });
      if (!allowed || content.hidden) {
        content.textContent = '';
        return false;
      }
      const second = await client.auth.getSession();
      if (
        second.error ||
        !sameOwner(second.data?.session, ownerId, session.access_token)
      ) {
        content.textContent = '';
        return false;
      }

      const listener = client.auth.onAuthStateChange((_event, nextSession) => {
        if (!sameOwner(nextSession, ownerId, session.access_token)) {
          section.remove();
          content.textContent = '';
          attached.delete(host);
        }
      });
      const unsubscribe = listener?.data?.subscription?.unsubscribe;
      if (typeof unsubscribe !== 'function') {
        content.textContent = '';
        return false;
      }
      // Recheck once more after subscribing, preventing a session change
      // during listener setup from exposing an old owner's notes.
      const third = await client.auth.getSession();
      if (
        third.error ||
        !sameOwner(third.data?.session, ownerId, session.access_token)
      ) {
        unsubscribe.call(listener.data.subscription);
        content.textContent = '';
        return false;
      }
      host.appendChild(section);
      attached.add(host);
      return true;
    } catch {
      return false;
    } finally {
      pending.delete(host);
    }
  }

  root.NovelightAiBibleOwnerStudio = Object.freeze({ attach });
})(globalThis);
