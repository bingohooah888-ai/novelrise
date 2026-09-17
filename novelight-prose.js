(function attachNovelightProse(global) {
  'use strict';

  const STYLE_ID = 'novelight-prose-style';
  const SELECTOR = '.novelight-page-episode .content, .nl-preview-content';
  const LIMITS = Object.freeze({
    rubyBase: 50,
    rubyReading: 30,
    emphasis: 80
  });

  function pushText(tokens, value) {
    if (!value) return;
    const previous = tokens[tokens.length - 1];
    if (previous?.type === 'text') {
      previous.text += value;
      return;
    }
    tokens.push({ type: 'text', text: value });
  }

  function isSingleLine(value) {
    return value.length > 0 && !/[\r\n]/u.test(value);
  }

  function tokenize(value) {
    const source = String(value ?? '');
    const tokens = [];
    let cursor = 0;

    while (cursor < source.length) {
      if (source.startsWith('《《', cursor)) {
        const close = source.indexOf('》》', cursor + 2);
        if (close !== -1) {
          const text = source.slice(cursor + 2, close);
          if (isSingleLine(text) && text.length <= LIMITS.emphasis) {
            tokens.push({ type: 'emphasis', text });
            cursor = close + 2;
            continue;
          }
        }
      }

      if (source[cursor] === '｜') {
        const readingOpen = source.indexOf('《', cursor + 1);
        if (readingOpen !== -1) {
          const base = source.slice(cursor + 1, readingOpen);
          const readingClose = source.indexOf('》', readingOpen + 1);
          if (readingClose !== -1) {
            const reading = source.slice(readingOpen + 1, readingClose);
            if (
              isSingleLine(base) &&
              isSingleLine(reading) &&
              base.length <= LIMITS.rubyBase &&
              reading.length <= LIMITS.rubyReading &&
              !/[《》｜]/u.test(base) &&
              !/[《》｜]/u.test(reading)
            ) {
              tokens.push({ type: 'ruby', base, reading });
              cursor = readingClose + 1;
              continue;
            }
          }
        }
      }

      pushText(tokens, source[cursor]);
      cursor += 1;
    }

    return tokens;
  }

  function installStyles(documentRef) {
    if (!documentRef?.head || documentRef.getElementById(STYLE_ID)) return;
    const style = documentRef.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .nl-prose-emphasis{-webkit-text-emphasis:filled dot;text-emphasis:filled dot;-webkit-text-emphasis-position:over right;text-emphasis-position:over right}
      .novelight-page-episode .content ruby,.nl-preview-content ruby{ruby-align:center}
      .novelight-page-episode .content rt,.nl-preview-content rt{font-size:.58em;line-height:1}
    `;
    documentRef.head.appendChild(style);
  }

  function appendRuby(documentRef, target, token) {
    const ruby = documentRef.createElement('ruby');
    ruby.appendChild(documentRef.createTextNode(token.base));
    const fallbackOpen = documentRef.createElement('rp');
    fallbackOpen.textContent = '（';
    const reading = documentRef.createElement('rt');
    reading.textContent = token.reading;
    const fallbackClose = documentRef.createElement('rp');
    fallbackClose.textContent = '）';
    ruby.append(fallbackOpen, reading, fallbackClose);
    target.appendChild(ruby);
  }

  function renderInto(element, value) {
    if (!element) return false;
    const documentRef = element.ownerDocument || global.document;
    if (!documentRef) return false;
    installStyles(documentRef);
    const fragment = documentRef.createDocumentFragment();
    for (const token of tokenize(value)) {
      if (token.type === 'text') {
        fragment.appendChild(documentRef.createTextNode(token.text));
      } else if (token.type === 'ruby') {
        appendRuby(documentRef, fragment, token);
      } else if (token.type === 'emphasis') {
        const emphasis = documentRef.createElement('span');
        emphasis.className = 'nl-prose-emphasis';
        emphasis.textContent = token.text;
        fragment.appendChild(emphasis);
      }
    }
    element.replaceChildren(fragment);
    element.dataset.novelightProseRendered = 'true';
    return true;
  }

  function enhance(root = global.document) {
    if (!root?.querySelectorAll) return 0;
    const nodes = [];
    if (root.matches?.(SELECTOR)) nodes.push(root);
    nodes.push(...root.querySelectorAll(SELECTOR));
    let rendered = 0;
    for (const node of nodes) {
      if (node.dataset.novelightProseRendered === 'true') continue;
      renderInto(node, node.textContent || '');
      rendered += 1;
    }
    return rendered;
  }

  function observe() {
    if (!global.document?.body || typeof global.MutationObserver !== 'function') return null;
    enhance(global.document);
    const observer = new global.MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node?.nodeType === 1) enhance(node);
        }
      }
    });
    observer.observe(global.document.body, { childList: true, subtree: true });
    return observer;
  }

  function start() {
    if (!global.document) return;
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', observe, { once: true });
    } else {
      observe();
    }
  }

  global.NovelightProse = Object.freeze({
    LIMITS,
    tokenize,
    renderInto,
    enhance,
    observe
  });

  start();
})(typeof window === 'undefined' ? globalThis : window);
