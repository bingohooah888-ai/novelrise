(function attachNovelightReaderTts(global) {
  'use strict';

  const SKIPPED_ELEMENTS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'RT', 'RP']);
  const MAX_CHUNK_LENGTH = 220;
  let mountedController = null;

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

  function mount(content) {
    if (!content || content.dataset.ttsMounted === 'true') return null;
    mountedController?.cancel();
    content.dataset.ttsMounted = 'true';
    const documentRef = content.ownerDocument;
    const synthesis = global.speechSynthesis;
    const Utterance = global.SpeechSynthesisUtterance;
    const supported = Boolean(synthesis && typeof Utterance === 'function');
    const controls = documentRef.createElement('section');
    controls.className = 'reader-tts';
    controls.setAttribute('aria-label', '本文の読み上げ');
    controls.innerHTML = '<div class="reader-tts-title">本文の読み上げ</div>' +
      '<div class="reader-tts-actions">' +
      '<button type="button" data-tts-action="start">最初から再生</button>' +
      '<button type="button" data-tts-action="pause">一時停止</button>' +
      '<button type="button" data-tts-action="resume">再開</button>' +
      '<button type="button" data-tts-action="stop">停止</button></div>' +
      '<p class="reader-tts-status" role="status" aria-live="polite"></p>';
    content.before(controls);

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

    function renderState(message) {
      status.textContent = message;
      startButton.disabled = !supported;
      pauseButton.disabled = !supported || !active || paused;
      resumeButton.disabled = !supported || !active || !paused;
      stopButton.disabled = !supported || !active;
    }
    function stop(message = '停止しました。') {
      runId += 1;
      active = false;
      paused = false;
      queue = [];
      queueIndex = 0;
      if (supported) synthesis.cancel();
      renderState(message);
    }
    function speakNext(expectedRunId) {
      if (!active || expectedRunId !== runId) return;
      if (queueIndex >= queue.length) {
        active = false;
        paused = false;
        renderState('読み上げが完了しました。');
        return;
      }
      const utterance = new Utterance(queue[queueIndex]);
      utterance.lang = 'ja-JP';
      const voice = preferredVoice(synthesis);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang || utterance.lang;
      }
      utterance.onend = () => {
        if (expectedRunId !== runId) return;
        queueIndex += 1;
        speakNext(expectedRunId);
      };
      utterance.onerror = (event) => {
        if (expectedRunId !== runId || event.error === 'canceled') return;
        stop('読み上げ中にエラーが発生しました。');
      };
      synthesis.speak(utterance);
    }

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
      renderState('本文を最初から読み上げています。');
      speakNext(runId);
    });
    pauseButton.addEventListener('click', () => {
      if (!active || paused) return;
      synthesis.pause();
      paused = true;
      renderState('一時停止しました。');
    });
    resumeButton.addEventListener('click', () => {
      if (!active || !paused) return;
      synthesis.resume();
      paused = false;
      renderState('読み上げを再開しました。');
    });
    stopButton.addEventListener('click', () => stop());

    const cancelForExit = () => stop('');
    global.addEventListener('pagehide', cancelForExit);
    global.addEventListener('beforeunload', cancelForExit);
    documentRef.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href]');
      if (link && !event.defaultPrevented && link.target !== '_blank') cancelForExit();
    }, true);
    renderState(supported
      ? '再生すると、このページに表示中の本文だけを読み上げます。'
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
    MAX_CHUNK_LENGTH, displayedText, chunksFor, preferredVoice, mount, enhance
  });
  start();
})(typeof window === 'undefined' ? globalThis : window);
