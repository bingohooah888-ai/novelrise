(function attachEpisodeTitleDisplay(global) {
  'use strict';

  function visibleTitle(value, episodeNumber, showNumber = true) {
    const title = String(value || '').trim();
    if (!showNumber || !Number.isInteger(Number(episodeNumber)) ||
        Number(episodeNumber) < 1) return title;

    const match = title.match(
      /^第[\s　]*([0-9０-９]+)[\s　]*話(?=$|[\s　:：\-－—・、.．「『【（(])/u
    );
    if (!match) return title;
    const matchedNumber = Number(
      match[1].replace(/[０-９]/gu, (digit) =>
        String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    );
    if (matchedNumber !== Number(episodeNumber)) return title;
    return title.slice(match[0].length)
      .replace(/^[\s　:：\-－—・、.．]+/u, '').trim();
  }

  function numberedTitle(value, episodeNumber, showNumber = true) {
    if (!showNumber) return String(value || '').trim();
    const prefix = `第${Number(episodeNumber)}話`;
    const title = visibleTitle(value, episodeNumber, true);
    return title ? `${prefix}　${title}` : prefix;
  }

  global.NovelightEpisodeTitleDisplay = Object.freeze({
    visibleTitle,
    numberedTitle
  });
})(typeof window === 'undefined' ? globalThis : window);
