// Privacy-safe browser diagnostics. Counts only; no URLs, request bodies,
// response bodies, console messages, account data, or page text are retained.
export function observeProjectPageLoad(page) {
  const counts = {
    scriptExceptions: 0,
    consoleErrors: 0,
    failedRequests: 0,
    http4xx: 0,
    http5xx: 0,
    http401: 0,
    http403: 0,
    http404: 0,
    http429: 0,
    http4xxOther: 0,
    http4xxDocument: 0,
    http4xxScript: 0,
    http4xxFetchOrXhr: 0
  };

  page.on('pageerror', () => {
    counts.scriptExceptions += 1;
  });
  page.on('console', message => {
    if (message.type() === 'error') counts.consoleErrors += 1;
  });
  page.on('requestfailed', () => {
    counts.failedRequests += 1;
  });
  page.on('response', response => {
    const status = response.status();
    if (status >= 400 && status < 500) {
      counts.http4xx += 1;
      if (status === 401) counts.http401 += 1;
      else if (status === 403) counts.http403 += 1;
      else if (status === 404) counts.http404 += 1;
      else if (status === 429) counts.http429 += 1;
      else counts.http4xxOther += 1;

      const kind = response.request().resourceType();
      if (kind === 'document') counts.http4xxDocument += 1;
      if (kind === 'script') counts.http4xxScript += 1;
      if (kind === 'fetch' || kind === 'xhr') {
        counts.http4xxFetchOrXhr += 1;
      }
    }
    if (status >= 500 && status < 600) counts.http5xx += 1;
  });
  return counts;
}
