(function () {
  'use strict';

  function esc(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  function ensureStyles() {
    if (document.getElementById('novelight-series-styles')) return;
    const style = document.createElement('style');
    style.id = 'novelight-series-styles';
    style.textContent =
      '.novelight-series-context{padding:24px 28px;margin-bottom:18px}' +
      '.novelight-series-context h2{font-size:20px;margin-bottom:5px}' +
      '.novelight-series-context .series-description{color:#666;line-height:1.7;margin-bottom:14px;white-space:pre-wrap}' +
      '.novelight-series-context ol{padding-left:24px;display:grid;gap:7px}' +
      '.novelight-series-context li.current{font-weight:900;color:#5b43bf}' +
      '.novelight-series-nav{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}' +
      '.novelight-series-nav a{padding:11px 13px;border:1px solid #d8d8df;border-radius:9px;background:#fff;font-size:13px;font-weight:800}' +
      '.novelight-series-nav a.next{text-align:right}' +
      '@media(max-width:640px){.novelight-series-context{padding:21px 18px}.novelight-series-nav{grid-template-columns:1fr}}';
    document.head.appendChild(style);
  }

  async function fetchContext(client, novelId) {
    const result = await client.rpc('novelight_public_series_context', {
      p_novel_id: String(novelId)
    });
    if (result.error) throw result.error;
    return Array.isArray(result.data) ? result.data : [];
  }

  async function mountNovelContext(client, novelId) {
    const episodesPanel = document.getElementById('episodesPanel');
    if (!episodesPanel) return;

    document.getElementById('novelightSeriesContext')?.remove();

    let rows;
    try {
      rows = await fetchContext(client, novelId);
    } catch (error) {
      console.error('series context unavailable', error);
      return;
    }
    if (!rows.length) return;

    rows.sort((a, b) => Number(a.item_position) - Number(b.item_position));
    const currentIndex = rows.findIndex((row) => row.is_current);
    if (currentIndex < 0) return;

    const current = rows[currentIndex];
    const previous = rows[currentIndex - 1] || null;
    const next = rows[currentIndex + 1] || null;
    const panel = document.createElement('section');
    panel.id = 'novelightSeriesContext';
    panel.className = 'panel novelight-series-context';
    panel.innerHTML =
      `<h2>シリーズ：${esc(current.series_title)}</h2>` +
      (current.series_description
        ? `<div class="series-description">${esc(current.series_description)}</div>`
        : '') +
      '<ol>' +
      rows
        .map(
          (row) =>
            `<li class="${row.is_current ? 'current' : ''}"><a href="novel.html?id=${encodeURIComponent(row.item_novel_id)}">${esc(row.item_title)}</a>${row.is_current ? '（現在）' : ''}</li>`
        )
        .join('') +
      '</ol>' +
      '<nav class="novelight-series-nav" aria-label="シリーズ内の作品移動">' +
      (previous
        ? `<a href="novel.html?id=${encodeURIComponent(previous.item_novel_id)}">← 前の作品<br>${esc(previous.item_title)}</a>`
        : '<span></span>') +
      (next
        ? `<a class="next" href="novel.html?id=${encodeURIComponent(next.item_novel_id)}">次の作品 →<br>${esc(next.item_title)}</a>`
        : '<span></span>') +
      '</nav>';

    ensureStyles();
    episodesPanel.parentNode.insertBefore(panel, episodesPanel);
  }

  window.NovelightSeries = Object.freeze({ fetchContext, mountNovelContext });
})();
