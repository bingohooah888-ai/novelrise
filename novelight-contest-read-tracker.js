(function attachContestReaderTracker(global) {
  'use strict';

  // No network requests until the explicit contest reader launch approval.
  if (global.NOVELIGHT_CONTEST_READER_CLIENT_ENABLED !== true) return;
  const doc = global.document;
  if (!doc) return;

  const endpoint = '/api/november-contest-read';
  const intervalMs = 12000;
  const inputs = ['scroll', 'wheel', 'touchmove', 'keydown'];
  let initialized = false;

  function visibleRatio(content) {
    const bounds = content.getBoundingClientRect();
    const height = Math.max(content.scrollHeight, bounds.height, 1);
    return Math.min(1, Math.max(0, (global.innerHeight - bounds.top) / height));
  }

  async function send(context, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (context.session?.access_token) {
      headers.Authorization = 'Bearer ' + context.session.access_token;
    }
    const response = await global.fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store'
    });
    return response.ok ? response.json() : { ok: false };
  }

  function mount(context) {
    if (initialized || !context?.unlocked || context.isAuthor ||
        !context.content) return;
    const episodeId = Number(context.episode?.id);
    if (!Number.isSafeInteger(episodeId) || episodeId <= 0) return;
    initialized = true;

    let mode = '';
    let sessionId = null;
    let sequence = 0;
    let progress = 0;
    let interaction = false;
    let speaking = false;
    let disabled = false;
    let linkChecked = !context.session?.access_token;
    let activeRequest = false;
    let generation = 0;
    let timer = null;

    function reset() {
      generation += 1;
      sessionId = null;
      sequence = 0;
      progress = 0;
      interaction = false;
      activeRequest = false;
      if (timer) global.clearInterval(timer);
      timer = null;
    }

    async function beat() {
      if (disabled || !sessionId || activeRequest ||
          doc.visibilityState !== 'visible' ||
          (mode === 'tts' && !speaking) ||
          (mode === 'scroll' && speaking)) return;
      const current = generation;
      activeRequest = true;
      const next = sequence + 1;
      try {
        const result = await send(context, {
          action: 'heartbeat',
          session_id: sessionId,
          sequence: next,
          progress_ratio: Math.min(1, Math.max(progress,
            mode === 'scroll' ? visibleRatio(context.content) : 0)),
          foreground: true,
          interacted: interaction
        });
        if (current !== generation) return;
        if (!result?.ok || result.qualified === true) {
          reset();
          return;
        }
        sequence = next;
        interaction = false;
      } catch {
        // A timed-out request may already have advanced the server sequence.
        // Never guess the next sequence; use a fresh bounded read session.
        if (current === generation) reset();
      } finally {
        if (current === generation) activeRequest = false;
      }
    }

    async function begin(nextMode) {
      if (disabled || activeRequest || sessionId ||
          doc.visibilityState !== 'visible') return;
      reset();
      mode = nextMode;
      const current = generation;
      activeRequest = true;
      try {
        // The signed guest credential is sent only as an HttpOnly cookie;
        // the verified account token is sent as Bearer. A failed link never
        // silently downgrades an authenticated session to guest scoring.
        if (!linkChecked) {
          const linked = await send(context, { action: 'link' });
          if (current !== generation) return;
          if (linked?.ok !== true) {
            disabled = true;
            return;
          }
          linkChecked = true;
        }
        const result = await send(context, {
          action: 'start',
          episode_id: episodeId,
          mode: nextMode
        });
        if (current !== generation) return;
        if (!result?.ok || !result.session_id) {
          // An inactive, denied, or exhausted reader must not retry on every
          // scroll event. A transient transport exception remains retriable.
          disabled = true;
          return;
        }
        sessionId = result.session_id;
        interaction = true;
        timer = global.setInterval(() => void beat(), intervalMs);
      } catch {
        // Network reconnect is handled by a later real reader interaction.
      } finally {
        if (current === generation) activeRequest = false;
      }
    }

    function onScroll(event) {
      if (event?.type === 'keydown' &&
          !['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) return;
      const tag = String(event?.target?.tagName || '').toUpperCase();
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return;
      if (disabled || speaking || doc.visibilityState !== 'visible') return;
      if (sessionId && mode !== 'scroll') reset();
      progress = Math.max(progress, visibleRatio(context.content));
      interaction = true;
      if (!sessionId) void begin('scroll');
    }

    function onTtsControls(event) {
      const action = event.target?.closest?.('[data-tts-action]')
        ?.getAttribute('data-tts-action');
      if (!action) return;
      if (action === 'start' || action === 'resume') {
        speaking = true;
        if (mode !== 'tts') reset();
        if (!sessionId) void begin('tts');
      } else if (action === 'pause' || action === 'stop') {
        speaking = false;
        if (mode === 'tts') reset();
      }
    }

    function onTtsProgress(event) {
      if (!speaking || doc.visibilityState !== 'visible') return;
      const amount = Number(event.detail?.ratio);
      if (Number.isFinite(amount)) {
        progress = Math.max(progress, Math.min(1, Math.max(0, amount)));
        interaction = true;
      }
      if (event.detail?.completed) {
        void beat();
        speaking = false;
        // Let the next foreground heartbeat observe the final progress if
        // one is already running. Ending speech is not itself proof of time.
      }
    }

    function onVisibility() {
      if (doc.visibilityState !== 'visible') {
        reset();
      } else if (speaking) {
        void begin('tts');
      }
    }

    function onOffline() {
      reset();
    }

    inputs.forEach((event) => {
      global.addEventListener(event, onScroll, { passive: true });
    });
    doc.addEventListener('click', onTtsControls);
    doc.addEventListener('novelight:tts-progress', onTtsProgress);
    doc.addEventListener('visibilitychange', onVisibility);
    global.addEventListener('offline', onOffline);
    global.addEventListener('online', onVisibility);
    global.addEventListener('pagehide', onOffline, { once: true });
  }

  doc.addEventListener('novelight:episode-rendered', (event) => {
    mount(event.detail);
  });
})(window);
