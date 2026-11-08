// Optional manuscript self-check for the two episode editors.
// Runs entirely in the browser. No model, API, storage, submission or network.
(function (root) {
  'use strict';

  const MAX_TITLE = 150;
  const MAX_CONTENT = 100000;
  const MAX_FINDINGS = 12;
  const OPEN = Object.freeze({
    '「': '」',
    '『': '』',
    '（': '）',
    '(': ')',
    '【': '】',
    '《': '》'
  });
  const CLOSE = new Set(Object.values(OPEN));

  function analyze({ title, content } = {}) {
    if (typeof title !== 'string' || typeof content !== 'string') return null;
    const findings = [];
    const add = (code, message, line = null) => {
      if (findings.length < MAX_FINDINGS) {
        findings.push({ code, message, line });
      }
    };

    if (!title.trim()) add('empty-title', 'エピソードタイトルが未入力です。');
    if (title.length > MAX_TITLE) {
      add('long-title', 'タイトルが150文字を超えています。');
    }
    if (!content.trim()) add('empty-body', '本文が未入力です。');
    if (content.length > MAX_CONTENT) {
      add('long-body', '本文が100,000文字を超えています。');
    }

    // The editor already sets maxlength. Bound inspection defensively too.
    const body = content.slice(0, MAX_CONTENT);
    const stack = [];
    let line = 1;
    let lineLength = 0;
    let longParagraphReported = false;
    for (const char of body) {
      if (char === '\n') {
        line += 1;
        lineLength = 0;
        continue;
      }
      if (!/[\s\r]/u.test(char)) lineLength += 1;
      if (!longParagraphReported && lineLength > 1200) {
        add(
          'long-paragraph',
          '長い段落があります。読みやすい改行か確認してください。',
          line
        );
        longParagraphReported = true;
      }
      if (Object.hasOwn(OPEN, char)) {
        // Do not let adversarial input make a huge stack.
        if (stack.length < 1000) stack.push({ opener: char, line });
      } else if (CLOSE.has(char)) {
        const last = stack[stack.length - 1];
        if (last && OPEN[last.opener] === char) {
          stack.pop();
        } else {
          add(
            'unmatched-close',
            '対応する開始括弧が見つからない箇所があります。',
            line
          );
        }
      }
    }
    for (const item of stack.slice(0, 3)) {
      add('unmatched-open', '閉じ括弧を確認してください。', item.line);
    }

    const placeholder =
      /(?:TODO|FIXME|TBD|ここに本文|ここに台詞|後で修正|後で追加|要推敲)/iu.exec(
        body
      );
    if (placeholder) {
      const at = body.slice(0, placeholder.index).split('\n').length;
      add('placeholder', '仮置きと思われる文言があります。', at);
    }

    return Object.freeze({
      titleLength: title.length,
      contentLength: content.length,
      findings: Object.freeze(findings.map((finding) => Object.freeze(finding)))
    });
  }

  function openReport(doc = root.document) {
    const title = doc?.getElementById?.('title');
    const content = doc?.getElementById?.('content');
    if (
      !title ||
      !content ||
      !doc?.createElement ||
      !doc.body ||
      doc.getElementById('nlPrepublishCheckDialog')
    ) {
      return false;
    }
    const report = analyze({ title: title.value, content: content.value });
    if (!report) return false;

    const previousFocus = doc.activeElement;
    const modal = doc.createElement('div');
    modal.id = 'nlPrepublishCheckDialog';
    modal.className = 'nl-preview-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', '文章セルフチェック');

    const card = doc.createElement('article');
    card.className = 'nl-preview-card';
    const close = doc.createElement('button');
    close.className = 'nl-preview-close';
    close.type = 'button';
    close.textContent = '閉じる';

    const heading = doc.createElement('h2');
    heading.className = 'nl-textcheck-title';
    heading.textContent = '文章セルフチェック';
    const explanation = doc.createElement('p');
    explanation.className = 'nl-textcheck-note';
    explanation.textContent =
      '入力漏れや表記の確認候補だけを端末内で確認します。AI校正・誤字検出・作品評価ではありません。保存や投稿は妨げません。';
    const counts = doc.createElement('p');
    counts.className = 'nl-textcheck-counts';
    counts.textContent =
      'タイトル ' +
      report.titleLength.toLocaleString('ja-JP') +
      '文字 ／ 本文 ' +
      report.contentLength.toLocaleString('ja-JP') +
      '文字';
    const summary = doc.createElement('p');
    summary.className = 'nl-textcheck-summary';
    summary.textContent = report.findings.length
      ? '確認候補 ' +
        report.findings.length +
        '件（必ずしも誤りとは限りません）'
      : '今回の機械的な確認では候補はありません。誤字脱字がないことを保証するものではありません。';

    const list = doc.createElement('ul');
    list.className = 'nl-textcheck-list';
    for (const finding of report.findings) {
      const item = doc.createElement('li');
      item.textContent =
        finding.line === null
          ? finding.message
          : finding.line + '行目：' + finding.message;
      list.appendChild(item);
    }

    card.append(close, heading, explanation, counts, summary, list);
    modal.appendChild(card);
    const dismiss = () => {
      doc.removeEventListener('keydown', keydown);
      modal.remove();
      previousFocus?.focus?.();
    };
    const keydown = (event) => {
      if (event.key === 'Escape') dismiss();
    };
    close.addEventListener('click', dismiss);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) dismiss();
    });
    doc.addEventListener('keydown', keydown);
    doc.body.appendChild(modal);
    close.focus();
    return true;
  }

  root.NovelightPrepublishCheck = Object.freeze({ analyze, openReport });
})(typeof window === 'object' ? window : globalThis);
