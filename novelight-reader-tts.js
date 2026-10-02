(function attachNovelightReaderTts(global) {
  'use strict';

  const SKIPPED_ELEMENTS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'RT', 'RP']);
  const MAX_CHUNK_LENGTH = 220;
  const MIN_PLAYBACK_RATE = 1;
  const MAX_PLAYBACK_RATE = 3;
  const PLAYBACK_RATE_STEP = 0.05;
  const TTS_VALID_READ_RATIO = 0.8;
  const TTS_HEARTBEAT_MS = 12000;
  const READING_STORAGE_PREFIX = 'novelight:reading:v1:';
  let mountedController = null;

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function newSessionId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    if (!global.crypto?.getRandomValues) return null;
    const bytes = new Uint8Array(16);
    global.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  function pageReadingContext() {
    try {
      if (typeof client === 'undefined' || typeof episode === 'undefined' || typeof novel === 'undefined') {
        return null;
      }
      return {
        client,
        episode,
        novel,
        session: typeof session === 'undefined' ? null : session,
        isAuthor: typeof isAuthor === 'undefined' ? false : Boolean(isAuthor)
      };
    } catch {
      return null;
    }
  }

  function displayedText(root) {
    if (!root) return '';
    const parts = [];
    function visit(node) {
      if (node.nodeType === 3) {
        parts.push(node.nodeValue || '');
        return;
      }
      if (node.nodeType !== 1 || SKIPPED_ELEMENTS.has(node.tagName)) return;
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return;
      for (const child of node.childNodes) visit(child);
      if (/^(P|DIV|BR|LI|BLOCKQUOTE)$/u.test(node.tagName)) parts.push('\n');
    }
    visit(root);
    return parts.join('').replace(/\r\n?/gu, '\n').replace(/[\t\f\v ]+/gu, ' ')
      .replace(/ *\n */gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();
  }

  function chunksFor(text) {
    const chunks = [];
    for (const paragraph of String(text || '').split(/\n+/u)) {
      let remaining = paragraph.trim();
      while (remaining) {
        if (remaining.length <= MAX_CHUNK_LENGTH) {
          chunks.push(remaining);
          break;
        }
        const candidate = remaining.slice(0, MAX_CHUNK_LENGTH);
        const boundary = Math.max(
          candidate.lastIndexOf('。'), candidate.lastIndexOf('！'),
          candidate.lastIndexOf('？'), candidate.lastIndexOf('、'),
          candidate.lastIndexOf(' ')
        );
        const length = boundary >= 40 ? boundary + 1 : MAX_CHUNK_LENGTH;
        chunks.push(remaining.slice(0, length).trim());
        remaining = remaining.slice(length).trim();
      }
    }
    return chunks.filter(Boolean);
  }

  function preferredVoice(synthesis) {
    const voices = synthesis.getVoices?.() || [];
    return voices.find((voice) => /^ja(?:-|_)/iu.test(voice.lang || '')) || null;
  }

  function normalizePlaybackRate(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return MIN_PLAYBACK_RATE;
    const clamped = Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, numeric));
    const stepped = MIN_PLAYBACK_RATE + Math.round(
      (clamped - MIN_PLAYBACK_RATE) / PLAYBACK_RATE_STEP
    ) * PLAYBACK_RATE_STEP;
    return Number(stepped.toFixed(2));
  }

  function formatPlaybackRate(value) {
    const normalized = normalizePlaybackRate(value);
    const fixed = normalized.toFixed(2);
    if (fixed.endsWith('00')) return `${normalized.toFixed(0)}.0`;
    if (fixed.endsWith('0')) return fixed.slice(0, -1);
    return fixed;
  }

  function saveLocalTtsProgress(context, ratio) {
    const novelId = String(context?.novel?.id || '');
    const episodeId = String(context?.episode?.id || '');
    if (!novelId || !episodeId) return { stored: null, shouldSync: false };
    const userId = context?.session?.user?.id || null;
    const episodeNumber = Number(context?.episode?.episode_number) || 0;
    const key = READING_STORAGE_PREFIX + novelId;
    let previous = null;
    try {
      previous = JSON.parse(global.localStorage.getItem(key) || 'null');
    } catch {
      previous = null;
    }
    if (userId && previous?.syncUserId && previous.syncUserId !== userId) previous = null;
    const previousNumber = Number(previous?.episodeNumber) || 0;
    if (previous && previousNumber > episodeNumber) {
      return { stored: previous, shouldSync: false };
    }
    const sameEpisode = previous && String(previous.episodeId) === episodeId;
    const nextRatio = sameEpisode ? Math.max(clamp(previous.progressRatio), clamp(ratio)) : clamp(ratio);
    const stored = {
      novelId,
      episodeId,
      episodeNumber,
      progressRatio: nextRatio,
      lastReadAt: new Date().toISOString(),
      syncUserId: userId
    };
    try {
      global.localStorage.setItem(key, JSON.stringify(stored));
    } catch (error) {
      console.warn('TTS reading progress could not be saved locally', error);
    }
    return { stored, shouldSync: Boolean(userId) };
  }

  async function syncTtsProgress(context, stored) {
    if (!context?.client || !stored?.syncUserId || context.isAuthor) return;
    try {
      const result = await context.client.from('reader_reading_progress').upsert({
        user_id: stored.syncUserId,
        novel_id: stored.novelId,
        episode_id: stored.episodeId,
        progress_ratio: clamp(stored.progressRatio),
        last_read_at: stored.lastReadAt
      }, { onConflict: 'user_id,novel_id' });
      if (result.error) throw result.error;
    } catch (error) {
      console.warn('TTS reading progress sync failed', error);
    }
  }

  function mount(content) {
    if (!content || content.dataset.ttsMounted === 'true') return null;
    mountedController?.cancel();
    content.dataset.ttsMounted = 'true';
    const documentRef = content.ownerDocument;
    const synthesis = global.speechSynthesis;
    const Utterance = global.SpeechSynthesisUtterance;
    const supported = Boolean(synthesis && typeof Utterance === 'function');
    const controls = documentRef.createElement('section');
    const panelId = `reader-tts-panel-${Math.random().toString(36).slice(2, 9)}`;
    controls.className = 'reader-tts';
    controls.setAttribute('aria-label', '本文の読み上げ');
    controls.innerHTML = '<div class="reader-tts-head">' +
      '<div class="reader-tts-title">🔊 本文の読み上げ</div>' +
      `<button class="reader-tts-toggle" type="button" aria-expanded="false" aria-controls="${panelId}" data-tts-toggle aria-label="読み上げ設定を開く">` +
      '<span class="reader-tts-compact-status" data-tts-compact-status></span>' +
      '<span class="reader-tts-chevron" aria-hidden="true">＋</span></button></div>' +
      `<div class="reader-tts-panel" id="${panelId}" data-tts-panel hidden>` +
      '<div class="reader-tts-actions">' +
      '<div class="reader-tts-rate">' +
      '<div class="reader-tts-rate-heading"><span>速度</span><output data-tts-rate-output>1.0×</output></div>' +
      '<div class="reader-tts-rate-main"><div class="reader-tts-rate-slider-wrap">' +
      '<input type="range" min="1" max="3" step="0.05" value="1" data-tts-rate-slider aria-label="読み上げ速度">' +
      '<div class="reader-tts-rate-scale" aria-hidden="true"><span>1.0</span><span>1.5</span><span>2.0</span><span>2.5</span><span>3.0</span></div>' +
      '</div><label class="reader-tts-rate-input"><input type="number" inputmode="decimal" min="1" max="3" step="0.05" value="1.0" data-tts-rate-input aria-label="読み上げ速度を直接入力"><span>倍</span></label></div>' +
      '</div>' +
      '<button type="button" data-tts-action="start">最初から再生</button>' +
      '<button type="button" data-tts-action="pause">一時停止</button>' +
      '<button type="button" data-tts-action="resume">再開</button>' +
      '<button type="button" data-tts-action="stop">停止</button></div>' +
      '<p class="reader-tts-status" role="status" aria-live="polite"></p></div>';
    content.before(controls);

    const head = controls.querySelector('.reader-tts-head');
    const toggleButton = controls.querySelector('[data-tts-toggle]');
    const panel = controls.querySelector('[data-tts-panel]');
    const compactStatus = controls.querySelector('[data-tts-compact-status]');
    const chevron = controls.querySelector('.reader-tts-chevron');
    const rateSlider = controls.querySelector('[data-tts-rate-slider]');
    const rateInput = controls.querySelector('[data-tts-rate-input]');
    const rateOutput = controls.querySelector('[data-tts-rate-output]');
    const startButton = controls.querySelector('[data-tts-action="start"]');
    const pauseButton = controls.querySelector('[data-tts-action="pause"]');
    const resumeButton = controls.querySelector('[data-tts-action="resume"]');
    const stopButton = controls.querySelector('[data-tts-action="stop"]');
    const status = controls.querySelector('.reader-tts-status');
    let queue = [];
    let queueIndex = 0;
    let active = false;
    let paused = false;
    let runId = 0;
    let ttsProgressRatio = 0;
    let ttsReadSessionId = null;
    let ttsClientSeq = 0;
    let ttsHeartbeatTimer = null;

    function setExpanded(expanded) {
      panel.hidden = !expanded;
      toggleButton.setAttribute('aria-expanded', String(expanded));
      toggleButton.setAttribute('aria-label', expanded ? '読み上げ設定を閉じる' : '読み上げ設定を開く');
      chevron.textContent = expanded ? '−' : '＋';
    }
    function toggleExpanded() {
      setExpanded(toggleButton.getAttribute('aria-expanded') !== 'true');
    }
    toggleButton.addEventListener('click', toggleExpanded);
    head.addEventListener('click', (event) => {
      if (event.target.closest?.('button, a, input, label')) return;
      toggleExpanded();
    });

    function setRate(value, syncInput = true) {
      const rate = normalizePlaybackRate(value);
      const formatted = formatPlaybackRate(rate);
      rateSlider.value = String(rate);
      if (syncInput) rateInput.value = formatted;
      rateOutput.textContent = `${formatted}×`;
      return rate;
    }
    function selectedRate() {
      return normalizePlaybackRate(rateSlider?.value || rateInput?.value || MIN_PLAYBACK_RATE);
    }
    function renderState(message) {
      status.textContent = message;
      startButton.disabled = !supported;
      pauseButton.disabled = !supported || !active || paused;
      resumeButton.disabled = !supported || !active || !paused;
      stopButton.disabled = !supported || !active;
      rateSlider.disabled = !supported;
      rateInput.disabled = !supported;
      if (!supported) compactStatus.textContent = '利用不可';
      else if (active) compactStatus.textContent = paused
        ? '一時停止中'
        : `読み上げ中 ${formatPlaybackRate(selectedRate())}×`;
      else if (message === '読み上げが完了しました。') compactStatus.textContent = '完了';
      else compactStatus.textContent = '';
    }
    function announceRateChange() {
      if (active) {
        renderState(`速度を${formatPlaybackRate(selectedRate())}倍に変更しました。次の区切りから反映されます。`);
      }
    }

    async function heartbeatTtsRead() {
      if (!active || paused || documentRef.visibilityState !== 'visible') return;
      const context = pageReadingContext();
      if (!context?.client || !context.session?.user?.id || context.isAuthor || !context.episode?.id) return;
      if (!ttsReadSessionId) ttsReadSessionId = newSessionId();
      if (!ttsReadSessionId) return;
      ttsClientSeq += 1;
      try {
        const result = await context.client.rpc('record_valid_read_progress', {
          p_episode_id: String(context.episode.id),
          p_session_id: ttsReadSessionId,
          p_progress_ratio: clamp(ttsProgressRatio),
          p_interaction_count: 0,
          p_client_seq: ttsClientSeq
        });
        if (result.error) throw result.error;
        if (result.data?.qualified === true && ttsHeartbeatTimer) {
          global.clearInterval(ttsHeartbeatTimer);
          ttsHeartbeatTimer = null;
        }
      } catch (error) {
        console.warn('TTS valid read progress failed', error);
      }
    }

    function startTtsReadTracking() {
      if (ttsHeartbeatTimer) global.clearInterval(ttsHeartbeatTimer);
      void heartbeatTtsRead();
      ttsHeartbeatTimer = global.setInterval(() => void heartbeatTtsRead(), TTS_HEARTBEAT_MS);
    }

    function stopTtsReadTracking() {
      if (!ttsHeartbeatTimer) return;
      global.clearInterval(ttsHeartbeatTimer);
      ttsHeartbeatTimer = null;
    }

    function reportTtsProgress(ratio, completed = false) {
      ttsProgressRatio = Math.max(ttsProgressRatio, clamp(ratio));
      const context = pageReadingContext();
      if (context) {
        const { stored, shouldSync } = saveLocalTtsProgress(context, completed ? 1 : ttsProgressRatio);
        if (shouldSync) void syncTtsProgress(context, stored);
      }
      documentRef.dispatchEvent(new global.CustomEvent('novelight:tts-progress', {
        detail: { ratio: completed ? 1 : ttsProgressRatio, completed }
      }));
      if (ttsProgressRatio >= TTS_VALID_READ_RATIO) void heartbeatTtsRead();
    }

    function stop(message = '停止しました。') {
      runId += 1;
      active = false;
      paused = false;
      queue = [];
      queueIndex = 0;
      stopTtsReadTracking();
      if (supported) synthesis.cancel();
      renderState(message);
    }
    function speakNext(expectedRunId) {
      if (!active || expectedRunId !== runId) return;
      if (queueIndex >= queue.length) {
        reportTtsProgress(1, true);
        active = false;
        paused = false;
        stopTtsReadTracking();
        renderState('読み上げが完了しました。');
        return;
      }
      const utterance = new Utterance(queue[queueIndex]);
      utterance.lang = 'ja-JP';
      utterance.rate = selectedRate();
      const voice = preferredVoice(synthesis);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang || utterance.lang;
      }
      utterance.onend = () => {
        if (expectedRunId !== runId) return;
        queueIndex += 1;
        reportTtsProgress(queue.length ? queueIndex / queue.length : 1, queueIndex >= queue.length);
        if (queueIndex >= queue.length) {
          active = false;
          paused = false;
          stopTtsReadTracking();
          renderState('読み上げが完了しました。');
          return;
        }
        speakNext(expectedRunId);
      };
      utterance.onerror = (event) => {
        if (expectedRunId !== runId || event.error === 'canceled') return;
        stop('読み上げ中にエラーが発生しました。');
      };
      synthesis.speak(utterance);
    }

    rateSlider.addEventListener('input', () => setRate(rateSlider.value));
    rateSlider.addEventListener('change', announceRateChange);
    rateInput.addEventListener('input', () => {
      if (rateInput.value === '' || !Number.isFinite(Number(rateInput.value))) return;
      setRate(rateInput.value, false);
    });
    rateInput.addEventListener('change', () => {
      setRate(rateInput.value);
      announceRateChange();
    });

    startButton.addEventListener('click', () => {
      global.NovelightProse?.enhance(content);
      const text = displayedText(content);
      if (!text) {
        renderState('読み上げる本文がありません。');
        return;
      }
      synthesis.cancel();
      runId += 1;
      queue = chunksFor(text);
      queueIndex = 0;
      active = true;
      paused = false;
      ttsProgressRatio = 0;
      ttsReadSessionId = newSessionId();
      ttsClientSeq = 0;
      renderState(`本文を最初から${formatPlaybackRate(selectedRate())}倍速で読み上げています。`);
      startTtsReadTracking();
      speakNext(runId);
    });
    pauseButton.addEventListener('click', () => {
      if (!active || paused) return;
      synthesis.pause();
      paused = true;
      stopTtsReadTracking();
      renderState('一時停止しました。');
    });
    resumeButton.addEventListener('click', () => {
      if (!active || !paused) return;
      synthesis.resume();
      paused = false;
      startTtsReadTracking();
      renderState('読み上げを再開しました。');
    });
    stopButton.addEventListener('click', () => stop());

    const visibilityChanged = () => {
      if (!active || paused) return;
      if (documentRef.visibilityState === 'visible') startTtsReadTracking();
      else stopTtsReadTracking();
    };
    documentRef.addEventListener('visibilitychange', visibilityChanged);
    const cancelForExit = () => stop('');
    global.addEventListener('pagehide', cancelForExit);
    global.addEventListener('beforeunload', cancelForExit);
    documentRef.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href]');
      if (link && !event.defaultPrevented && link.target !== '_blank') cancelForExit();
    }, true);
    setExpanded(false);
    setRate(MIN_PLAYBACK_RATE);
    renderState(supported
      ? '速度を1.0〜3.0倍で調整して再生すると、このページに表示中の本文だけを読み上げます。'
      : 'このブラウザは本文の読み上げに対応していません。');
    mountedController = { cancel: () => stop('') };
    return controls;
  }

  function enhance(root = global.document) {
    if (!root?.querySelectorAll) return 0;
    const nodes = [];
    if (root.matches?.('.novelight-page-episode .content')) nodes.push(root);
    nodes.push(...root.querySelectorAll('.novelight-page-episode .content'));
    for (const node of nodes) mount(node);
    return nodes.length;
  }

  function start() {
    if (!global.document) return;
    const observe = () => {
      enhance(global.document);
      if (typeof global.MutationObserver !== 'function') return;
      const observer = new global.MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node?.nodeType === 1) enhance(node);
          }
        }
      });
      observer.observe(global.document.body, { childList: true, subtree: true });
    };
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', observe, { once: true });
    } else {
      observe();
    }
  }

  global.NovelightReaderTts = Object.freeze({
    MAX_CHUNK_LENGTH,
    TTS_VALID_READ_RATIO,
    displayedText,
    chunksFor,
    preferredVoice,
    mount,
    enhance
  });
  start();
})(typeof window === 'undefined' ? globalThis : window);
