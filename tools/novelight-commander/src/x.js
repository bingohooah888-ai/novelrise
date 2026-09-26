const FXTWITTER_BASE = 'https://api.fxtwitter.com';
const USER_AGENT = 'NOVELIGHT-Commander/0.6 (+https://github.com/bingohooah888-ai/novelrise)';

function timeoutSignal(ms = 15000) {
  return AbortSignal.timeout(ms);
}

export function normalizeXHandle(input) {
  const value = String(input || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(value)) {
    throw new Error('X handle must be 1-15 letters, digits or underscores.');
  }
  return value;
}

export function extractXStatusId(input) {
  const value = String(input || '').trim();
  if (/^\d{2,20}$/.test(value)) return value;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('X post must be a numeric status id or an x.com/twitter.com status URL.');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!['x.com', 'twitter.com', 'mobile.twitter.com'].includes(host)) {
    throw new Error('Only x.com or twitter.com status URLs are accepted.');
  }

  const match = url.pathname.match(/\/status\/(\d{2,20})(?:\/|$)/);
  if (!match) throw new Error('X status URL does not contain a valid status id.');
  return match[1];
}

async function requestJson(pathname, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable.');
  const response = await fetchImpl(FXTWITTER_BASE + pathname, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT
    },
    signal: timeoutSignal()
  });

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(`FxTwitter request failed: ${detail}`);
  }
  return payload;
}

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function summarizeXStatus(status) {
  if (!status || typeof status !== 'object') return null;
  const author = status.author || status.user || null;
  const screenName = author?.screen_name || author?.screenName || author?.username || null;
  const id = String(status.id || status.id_str || '').trim() || null;
  return {
    id,
    url: status.url || (id && screenName ? `https://x.com/${screenName}/status/${id}` : null),
    text: typeof status.text === 'string' ? status.text : '',
    createdAt: status.created_at || status.createdAt || null,
    author: author ? {
      name: author.name || null,
      screenName,
      followers: safeNumber(author.followers),
      following: safeNumber(author.following)
    } : null,
    metrics: {
      views: safeNumber(status.views),
      likes: safeNumber(status.likes),
      reposts: safeNumber(status.reposts ?? status.retweets),
      replies: safeNumber(status.replies),
      quotes: safeNumber(status.quotes),
      bookmarks: safeNumber(status.bookmarks)
    }
  };
}

function flattenTimelineResults(payload) {
  const raw = Array.isArray(payload?.results) ? payload.results : [];
  const statuses = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'thread' && Array.isArray(item.statuses)) {
      statuses.push(...item.statuses);
    } else if (item.type === 'thread' && Array.isArray(item.thread)) {
      statuses.push(...item.thread);
    } else {
      statuses.push(item);
    }
  }
  return statuses;
}

export async function fetchRecentXPosts(handle, options = {}) {
  const normalized = normalizeXHandle(handle);
  const count = Math.max(1, Math.min(20, Number(options.count || 10)));
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const pathname = `/2/profile/${encodeURIComponent(normalized)}/statuses?count=${count}`;
  const payload = await requestJson(pathname, fetchImpl);
  if (!payload) {
    return { source: 'fxtwitter', handle: normalized, posts: [], cursor: null };
  }
  const posts = flattenTimelineResults(payload)
    .map(summarizeXStatus)
    .filter(Boolean)
    .slice(0, count);
  return {
    source: 'fxtwitter',
    handle: normalized,
    posts,
    cursor: payload?.cursor?.bottom || payload?.cursor || null
  };
}

export async function fetchXPostMetrics(urlOrId, options = {}) {
  const id = extractXStatusId(urlOrId);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const payload = await requestJson(`/2/status/${id}`, fetchImpl);
  const status = payload?.status || payload?.tweet || payload;
  const post = summarizeXStatus(status);
  if (!post || !post.id) throw new Error('FxTwitter returned no readable post.');
  return {
    source: 'fxtwitter',
    post
  };
}
