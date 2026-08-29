export const SEARCH_EMPTY_MESSAGE = '条件に合う作品がありません。';

export function resolveSearchCatalogState({
  resultText,
  cardCount,
  emptyText
}) {
  const normalizedResult = String(resultText ?? '').trim();

  if (!Number.isInteger(cardCount) || cardCount < 0) {
    throw new Error(`Invalid search card count: ${cardCount}`);
  }

  if (
    normalizedResult === '読み込み中...' ||
    normalizedResult === '読み込みエラー'
  ) {
    throw new Error(`Search catalog is not healthy: ${normalizedResult}`);
  }

  const countMatch = normalizedResult.match(/^([\d,]+)作品$/);
  if (!countMatch) {
    throw new Error(
      `Unexpected search result count: ${normalizedResult || '<empty>'}`
    );
  }

  const total = Number(countMatch[1].replaceAll(',', ''));
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error(`Invalid search result total: ${normalizedResult}`);
  }

  if (total === 0) {
    if (cardCount !== 0) {
      throw new Error('Search reports 0 works but rendered novel cards.');
    }
    if (String(emptyText ?? '').trim() !== SEARCH_EMPTY_MESSAGE) {
      throw new Error('Search empty catalog is missing the expected empty state.');
    }
    return 'empty';
  }

  if (cardCount < 1) {
    throw new Error(`Search reports ${total} works but rendered no novel cards.`);
  }

  return 'populated';
}
