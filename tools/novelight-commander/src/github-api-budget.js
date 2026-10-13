// Shared budget for the supervised NLO GitHub Bridge. This code does not touch
// authentication headers, GitHub issue allowlists, or non-GitHub network traffic.
const API_ORIGIN = 'https://api.github.com';
const DEFAULT_SPACING_MS = 1200;
const DEFAULT_RECOVERY_MS = 90_000;
const PRIMARY_RESERVE = 100;

function githubApiUrl(input) {
  try {
    const raw = typeof input === 'string' || input instanceof URL ? input : input?.url;
    const url = new URL(raw);
    return url.origin === API_ORIGIN;
  } catch {
    return false;
  }
}

function retryAfterMillis(header, now) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function resetMillis(header, now) {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.max(0, seconds * 1000 - now);
}

function blockedResponse(milliseconds) {
  return new Response(
    JSON.stringify({ message: 'NLO GitHub API rate budget is cooling down' }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(Math.max(1, Math.ceil(milliseconds / 1000)))
      }
    }
  );
}

export function createGithubApiBudgetFetch({
  fetchImpl,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  spacingMs = DEFAULT_SPACING_MS,
  reserve = PRIMARY_RESERVE
}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  let nextAllowedAt = 0;
  let pausedUntil = 0;
  let secondaryRecovery = DEFAULT_RECOVERY_MS;
  let queue = Promise.resolve();

  async function request(input, init) {
    if (!githubApiUrl(input)) return fetchImpl(input, init);
    const operation = async () => {
      if (now() < pausedUntil) return blockedResponse(pausedUntil - now());

      const wait = Math.max(0, nextAllowedAt - now());
      if (wait) await sleep(wait);
      if (now() < pausedUntil) return blockedResponse(pausedUntil - now());

      nextAllowedAt = now() + Math.max(0, spacingMs);
      const response = await fetchImpl(input, init);
      const remainingHeader = response.headers.get('x-ratelimit-remaining');
      const remaining = remainingHeader === null ? NaN : Number(remainingHeader);
      const reset = resetMillis(response.headers.get('x-ratelimit-reset'), now());
      const retry = retryAfterMillis(response.headers.get('retry-after'), now());

      if (response.status === 403 || response.status === 429) {
        const message = await response.clone().text();
        const rateLimited = response.status === 429 ||
          Number.isFinite(remaining) && remaining === 0 ||
          /(?:API|secondary|primary) rate limit|abuse detection/i.test(message);
        if (rateLimited) {
          const suggested = Math.max(
            60_000,
            retry ?? 0,
            remaining === 0 && reset !== null ? reset + 2000 : 0,
            remaining !== 0 ? secondaryRecovery : 0
          );
          pausedUntil = Math.max(pausedUntil, now() + suggested);
          secondaryRecovery = Math.min(900_000, secondaryRecovery * 2);
        }
      } else if (response.ok) {
        secondaryRecovery = DEFAULT_RECOVERY_MS;
        if (Number.isFinite(remaining) && remaining <= reserve && reset !== null) {
          pausedUntil = Math.max(pausedUntil, now() + reset + 2000);
        }
      }
      return response;
    };

    // Serialize all authenticated GitHub calls from the many bridge loops.
    // A failed fetch cannot poison the following requests.
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  return {
    fetch: request,
    getPausedUntil: () => pausedUntil,
    getNextAllowedAt: () => nextAllowedAt
  };
}
