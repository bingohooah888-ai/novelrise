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

  // Mechanical reading aid, not linguistic sentence analysis. Ignore whitespace;
  // split on line breaks and Japanese/ASCII terminal punctuation, not decimal dots.
  // The same bounded manuscript prefix is used for counts and source positions.
  function measureSegments(body) {
    let line = 1;
    let size = 0;
    let count = 0;
    let total = 0;
    let max = 0;
    const longLines = [];
    const finish = () => {
      if (size === 0) return;
      count += 1;
      total += size;
      max = Math.max(max, size);
      if (size >= 120 && longLines.length < 3 && !longLines.includes(line)) {
        longLines.push(line);
      }
      size = 0;
    };
    for (const char of body) {
      if (char === '\n') {
        finish();
        line += 1;
      } else if (/[。！？!?]/u.test(char)) {
        finish();
      } else if (!/\s/u.test(char)) {
        size += 1;
      }
    }
    finish();
    return {
      count,
      average: count ? Math.round(total / count) : 0,
      max,
      longLines
    };
  }

  function analyze({ title, content } = {}) {
    if (typeof title !== 'string' || typeof content !== 'string') return null;
    const findings = [];
    let omitted = false;
    const add = (code, message, line = null) => {
      if (findings.length < MAX_FINDINGS) {
        findings.push({ code, message, line });
      } else {
        omitted = true;
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
    let bracketLimitReached = false;
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
        if (stack.length < 1000 && !bracketLimitReached) {
          stack.push({ opener: char, line });
        } else if (!bracketLimitReached) {
          bracketLimitReached = true;
          add('bracket-limit', '括弧が深く入れ子になっています。確認範囲を超えました。', line);
        }
      } else if (CLOSE.has(char) && !bracketLimitReached) {
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
    if (!bracketLimitReached) {
      for (const item of stack.slice(0, 3)) {
        add('unmatched-open', '閉じ括弧を確認してください。', item.line);
      }
      if (stack.length > 3) omitted = true;
    }

    const placeholder =
      /(?:TODO|FIXME|TBD|ここに本文|ここに台詞|後で修正|後で追加|要推敲)/iu.exec(
        body
      );
    if (placeholder) {
      const at = body.slice(0, placeholder.index).split('\n').length;
      add('placeholder', '仮置きと思われる文言があります。', at);
    }

    // Adjacent identical non-empty lines can be intentional repetition.
    // Report only the location; never reproduce the manuscript in findings.
    let previousLine = '';
    let repeatedLines = 0;
    const lines = body.split('\n');
    for (let i = 0; i < lines.length && repeatedLines < 3; i += 1) {
      const currentLine = lines[i].trim();
      if (currentLine.length >= 8 && currentLine === previousLine) {
        add(
          'repeated-line',
          '直前の行と同じ文章です。意図した繰り返しか確認してください。',
          i + 1
        );
        repeatedLines += 1;
      }
      previousLine = currentLine;
    }

    // Distant exact repetitions are a copy/paste check, not a style verdict.
    // Exclude adjacent repeats (already covered) and bound retained candidates.
    const seenLines = new Map();
    let distant = 0;
    let nonemptyLines = 0;
    let quotedLines = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const value = lines[i].trim();
      if (!value) continue;
      nonemptyLines += 1;
      if (/^(?:「[^\n]+」|『[^\n]+』)$/u.test(value)) quotedLines += 1;
      if (value.length < 20 || distant >= 3) continue;
      const first = seenLines.get(value);
      if (first !== undefined && i - first > 1 && value !== lines[i - 1]?.trim()) {
        add('distant-repeat', '離れた行に同じ文章があります（' +
          (first + 1) + '行目と一致）。意図した繰り返しか確認してください。', i + 1);
        distant += 1;
      }
      if (first === undefined) seenLines.set(value, i);
    }

    // Literal conventions only: do not infer linguistic errors, author
    // intent, or rewrite text. Each extra category reports at most one line.
    const conventions = [
      ['mixed-ellipsis', /…{1,}(?!…)/u, /\.{3,}/u, '三点リーダーとピリオドの連続が混在しています。'],
      ['mixed-question', /？/u, /\?/u, '全角・半角の疑問符が混在しています。'],
      ['mixed-exclamation', /！/u, /!/u, '全角・半角の感嘆符が混在しています。']
    ];
    for (const [code, full, half, message] of conventions) {
      if (full.test(body) && half.test(body)) {
        const at = lines.findIndex((text) => half.test(text));
        add(code, message + '意図した表記か確認してください。', at + 1);
      }
    }
    const emptyRuby = lines.findIndex((text) => /｜[^\n《》｜]+《[ \t　]*》/u.test(text));
    if (emptyRuby >= 0) {
      add('empty-ruby', 'ルビの読みが空欄です。意図した記法か確認してください。', emptyRuby + 1);
    }

    const segments = measureSegments(body);
    for (const at of segments.longLines) {
      add(
        'long-segment',
        '120文字以上の区間があります。文の区切りや読みやすさを確認してください。',
        at
      );
    }

    return Object.freeze({
      lineMetrics: Object.freeze({ nonemptyLines, quotedLines }),
      segmentMetrics: Object.freeze({
        count: segments.count,
        average: segments.average,
        max: segments.max,
        limited: content.length > MAX_CONTENT
      }),
      titleLength: title.length,
      contentLength: content.length,
      omitted,
      inspectionLimited: bracketLimitReached || content.length > MAX_CONTENT,
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
    const inspectedTitle = title.value;
    const inspectedContent = content.value;
    const report = analyze({ title: inspectedTitle, content: inspectedContent });
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
      '文字' +
      ' ／ 文章の目安（改行・句点等で区切り' +
      (report.segmentMetrics.limited ? '・先頭100,000文字のみ' : '') +
      '）：' +
      report.segmentMetrics.count.toLocaleString('ja-JP') +
      '区間、平均 ' +
      report.segmentMetrics.average.toLocaleString('ja-JP') +
      '文字、最長 ' +
      report.segmentMetrics.max.toLocaleString('ja-JP') +
      '文字 ／ 空白以外の行 ' + report.lineMetrics.nonemptyLines +
      '行、かぎ括弧で始まり終わる行 ' + report.lineMetrics.quotedLines +
      '行（会話量の判定ではありません）';
    const summary = doc.createElement('p');
    summary.className = 'nl-textcheck-summary';
    summary.textContent = report.findings.length
      ? '確認候補 ' +
        report.findings.length +
        '件（必ずしも誤りとは限りません）' +
        (report.omitted ? '。表示上限があります。' : '') +
        (report.inspectionLimited ? '。一部の確認範囲を超えています。' : '')
      : '今回の機械的な確認では候補はありません。誤字脱字がないことを保証するものではありません。';

    const list = doc.createElement('ul');
    list.className = 'nl-textcheck-list';
    for (const finding of report.findings) {
      const item = doc.createElement('li');
      item.textContent =
        finding.line === null
          ? finding.message
          : finding.line + '行目：' + finding.message;
      if (
        finding.line !== null &&
        typeof content.setSelectionRange === 'function'
      ) {
        const locate = doc.createElement('button');
        locate.type = 'button';
        locate.textContent = '該当行へ移動';
        locate.setAttribute('aria-label', finding.line + '行目へ移動');
        locate.addEventListener('click', () => {
          // A changed manuscript or replaced editor invalidates line positions.
          if (
            doc.getElementById('content') !== content ||
            doc.getElementById('title') !== title ||
            title.value !== inspectedTitle ||
            content.value !== inspectedContent
          ) {
            summary.textContent =
              '原稿が変更されました。閉じて文章チェックをやり直してください。';
            return;
          }
          let start = 0;
          for (let i = 1; i < finding.line; i += 1) {
            const newline = inspectedContent.indexOf('\n', start);
            if (newline < 0) return;
            start = newline + 1;
          }
          const newline = inspectedContent.indexOf('\n', start);
          let end = newline < 0 ? inspectedContent.length : newline;
          if (end > start && inspectedContent[end - 1] === '\r') end -= 1;
          dismiss(false);
          content.focus?.();
          content.setSelectionRange(start, end);
        });
        item.appendChild(locate);
      }
      list.appendChild(item);
    }

    card.append(close, heading, explanation, counts, summary, list);
    modal.appendChild(card);
    const dismiss = (restoreFocus = true) => {
      doc.removeEventListener('keydown', keydown);
      modal.remove();
      if (restoreFocus) previousFocus?.focus?.();
    };
    const keydown = (event) => {
      if (event.key === 'Escape') dismiss();
    };
    close.addEventListener('click', () => dismiss());
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
