const MAX_EPISODES = 100;
const MAX_EPISODE_CHARS = 100000;

const normalizeDigits = (value) =>
  String(value ?? '').replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );

const japaneseNumber = (value) => {
  const normalized = normalizeDigits(value).trim();
  if (/^\d+$/.test(normalized)) return Number(normalized);

  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let current = 0;
  for (const char of normalized) {
    if (Object.hasOwn(digits, char)) {
      current = digits[char];
      continue;
    }
    if (Object.hasOwn(units, char)) {
      total += (current || 1) * units[char];
      current = 0;
      continue;
    }
    return null;
  }
  total += current;
  return total > 0 ? total : null;
};

const headingPatterns = [
  /^\s*第\s*([0-9０-９一二三四五六七八九十百千〇零]+)\s*(?:話|章)\s*(?:[：:\-—－\s　]+)?(.*?)\s*$/iu,
  /^\s*([0-9０-９]+)\s*話\s*(?:[：:\-—－\s　]+)?(.*?)\s*$/iu,
  /^\s*(?:episode|chapter)\s*([0-9]+)\s*(?:[：:\-—－.\s]+)?(.*?)\s*$/iu,
  /^\s*ep\.?\s*([0-9]+)\s*(?:[：:\-—－.\s]+)?(.*?)\s*$/iu
];

export const normalizeImportText = (text) =>
  String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');

export function parseHeading(line) {
  for (const pattern of headingPatterns) {
    const match = String(line ?? '').match(pattern);
    if (!match) continue;
    const number = japaneseNumber(match[1]);
    if (!number || !Number.isInteger(number) || number < 1) continue;
    return { sourceNumber: number, title: String(match[2] ?? '').trim() };
  }
  return null;
}

const finishItem = (current, items) => {
  if (!current) return;
  const content = current.lines.join('\n').replace(/^\n+|\n+$/g, '');
  items.push({
    sourceNumber: current.sourceNumber,
    title: current.title,
    content,
    included: true
  });
};

function parseWithHeadings(text) {
  const lines = normalizeImportText(text).split('\n');
  const items = [];
  let current = null;
  for (const line of lines) {
    const heading = parseHeading(line);
    if (heading) {
      finishItem(current, items);
      current = { ...heading, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  finishItem(current, items);
  return items;
}

function parseWithDelimiter(text, delimiter) {
  const marker = String(delimiter ?? '').trim();
  if (!marker) return [];
  const normalized = normalizeImportText(text);
  const chunks = normalized
    .split(new RegExp(`^\\s*${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')')}\\s*$`, 'gmu'))
    .map((chunk) => chunk.replace(/^\n+|\n+$/g, ''))
    .filter(Boolean);

  return chunks.map((chunk, index) => {
    const lines = chunk.split('\n');
    const first = String(lines[0] ?? '').trim();
    const parsed = parseHeading(first);
    if (parsed) {
      return {
        sourceNumber: parsed.sourceNumber,
        title: parsed.title,
        content: lines.slice(1).join('\n').replace(/^\n+|\n+$/g, ''),
        included: true
      };
    }
    return {
      sourceNumber: index + 1,
      title: first.length <= 150 ? first : '',
      content: (first.length <= 150 ? lines.slice(1) : lines)
        .join('\n')
        .replace(/^\n+|\n+$/g, ''),
      included: true
    };
  });
}

export function parseBulkEpisodes(text, options = {}) {
  const delimiter = String(options.delimiter ?? '').trim();
  return delimiter ? parseWithDelimiter(text, delimiter) : parseWithHeadings(text);
}

export function validateBulkEpisodes(items, options = {}) {
  const maxEpisodes = Number(options.maxEpisodes ?? MAX_EPISODES);
  const maxChars = Number(options.maxChars ?? MAX_EPISODE_CHARS);
  const errors = [];
  const active = (items ?? []).filter((item) => item.included !== false);

  if (!active.length) errors.push('移行するエピソードを1話以上選択してください。');
  if (active.length > maxEpisodes) errors.push(`一度に移行できるのは${maxEpisodes}話までです。`);

  active.forEach((item, index) => {
    const label = `${index + 1}話目`;
    const title = String(item.title ?? '');
    const content = String(item.content ?? '');
    if (title.length > 150) errors.push(`${label}: タイトルは150文字以内にしてください。`);
    if (!content.trim()) errors.push(`${label}: 本文が空です。`);
    if (content.length > maxChars) errors.push(`${label}: 本文は${maxChars.toLocaleString('ja-JP')}文字以内にしてください。`);
  });

  return errors;
}

export function duplicateWarnings(items, existing = []) {
  const warnings = new Set();
  const seen = new Map();
  const active = (items ?? []).filter((item) => item.included !== false);

  active.forEach((item, index) => {
    const title = String(item.title ?? '');
    const content = String(item.content ?? '');
    const exact = `${title}\u0000${content}`;
    if (seen.has(exact)) {
      warnings.add(`${index + 1}話目は、今回の移行内の別エピソードとタイトル・本文が一致しています。`);
    } else {
      seen.set(exact, index);
    }

    if ((existing ?? []).some((row) => String(row.content ?? '') === content)) {
      warnings.add(`${index + 1}話目は、既存エピソードと本文が一致する可能性があります。`);
    }
    if (
      (existing ?? []).some(
        (row) => String(row.title ?? '') === title && String(row.content ?? '') === content
      )
    ) {
      warnings.add(`${index + 1}話目は、既存エピソードとタイトル・本文が一致しています。`);
    }
  });

  return [...warnings];
}

export const BULK_IMPORT_LIMITS = Object.freeze({
  maxEpisodes: MAX_EPISODES,
  maxEpisodeChars: MAX_EPISODE_CHARS,
  maxFileBytes: 5 * 1024 * 1024
});
