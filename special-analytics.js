/* SPECIAL-only anonymous interaction counts; independent of reading/ranking. */
(() => {
  const main = document.querySelector('main[data-special-project]');
  const projectId = main?.getAttribute('data-special-project') || '';
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      projectId
    )
  )
    return;
  const types = new Set([
    'page_view',
    'content_click',
    'novel_click',
    'official_click'
  ]);
  function record(eventType, target = '') {
    if (!types.has(eventType)) return;
    try {
      fetch('/api/special-event', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          event_type: eventType,
          target
        })
      }).catch(() => {});
    } catch {
      /* Metrics never block reading. */
    }
  }
  record('page_view');
  main.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[data-special-event]');
    if (!link || !main.contains(link)) return;
    record(link.dataset.specialEvent, link.dataset.specialTarget || '');
  });
})();
