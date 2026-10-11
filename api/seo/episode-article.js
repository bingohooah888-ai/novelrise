import { escapeHtml } from './public-page.js';

// Match the browser's display-only title normalization. Keep the original
// author-entered title whenever automatic episode numbers are disabled.
export function visibleEpisodeTitle(value, episodeNumber, showNumber = true) {
  const title = String(value || '').trim();
  if (
    !showNumber ||
    !Number.isInteger(Number(episodeNumber)) ||
    Number(episodeNumber) < 1
  ) {
    return title;
  }

  const match = title.match(
    /^第[\s　]*([0-9０-９]+)[\s　]*話(?=$|[\s　:：\-－—・、.．「『【（(])/u
  );
  if (!match) return title;
  const matchedNumber = Number(
    match[1].replace(/[０-９]/gu, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xfee0)
    )
  );
  if (matchedNumber !== Number(episodeNumber)) return title;
  return title
    .slice(match[0].length)
    .replace(/^[\s　:：\-－—・、.．]+/u, '')
    .trim();
}

export function renderEpisodeArticle(episode, novel, content) {
  const showNumber =
    novel.show_episode_numbers !== false &&
    episode.show_episode_number !== false;
  const heading =
    visibleEpisodeTitle(episode.title, episode.episode_number, showNumber) ||
    '本文を読む';
  const number = showNumber
    ? `<div class="number">第${escapeHtml(episode.episode_number)}話</div>`
    : '';
  const novelUrl = encodeURIComponent(novel.id);
  return `<article id="card" class="card"><div class="novel-title"><a href="novel.html?id=${novelUrl}">${escapeHtml(novel.title)}</a></div>${number}<h1>${escapeHtml(heading)}</h1><div class="content">${escapeHtml(content)}</div></article>`;
}
