// Staging-only receipt of an actual Supabase signup confirmation email.
// No mailbox setup, email sending, admin confirmation, or auto-bypass here.
// Resend inbound GET endpoints are read-only; never log mail bodies or links.
const API = 'https://api.resend.com/emails/receiving';
const STAGING_AUTH = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SUBJECT = '【NOVELIGHT】メールアドレスの確認';

function deny() {
  throw new Error('STAGING_READER_MAILBOX_DENIED');
}

export function requireReaderMailbox(env = process.env) {
  const domain = String(env.NOVELIGHT_STAGING_READER_MAILBOX_DOMAIN || '')
    .trim()
    .toLowerCase();
  const sender = String(env.NOVELIGHT_STAGING_READER_MAILBOX_SENDER || '')
    .trim()
    .toLowerCase();
  const apiKey = env.NOVELIGHT_STAGING_READER_MAILBOX_API_KEY || '';
  if (
    !/^[a-z0-9][a-z0-9-]{3,62}\.resend\.app$/u.test(domain) ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/u.test(sender) ||
    !apiKey.startsWith('re_') ||
    apiKey.length < 12
  ) {
    deny();
  }
  return { domain, sender, apiKey };
}

export function uniqueReaderAddress(mailbox, id) {
  if (!UUID.test(id || '') || !mailbox?.domain) deny();
  return 'novelight-staging-reader-ui-' + id + '@' + mailbox.domain;
}

async function inboundGet(path, apiKey, fetcher) {
  let payload;
  try {
    const response = await fetcher(API + path, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json'
      },
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(8000)
    });
    if (!response.ok) deny();
    payload = await response.json();
  } catch {
    deny();
  }
  return payload;
}

// Must succeed BEFORE the test creates an Auth reader. This verifies inbound
// API read access, not domain MX routing or an email delivery guarantee.
export async function preflightReaderMailbox(mailbox, fetcher = globalThis.fetch) {
  const list = await inboundGet('?limit=30', mailbox.apiKey, fetcher);
  if (list?.object !== 'list' || !Array.isArray(list.data)) deny();
  return true;
}

function canonicalSender(value) {
  const raw = String(value || '').trim();
  const match = /<([^<>]+)>$/u.exec(raw);
  return (match ? match[1] : raw).toLowerCase();
}

export function requireSignupVerificationLink(raw, previewOrigin) {
  let url;
  try {
    url = new globalThis.URL(raw);
  } catch {
    deny();
  }
  const redirect = new globalThis.URL('/index.html', previewOrigin).href;
  const token = url.searchParams.get('token');
  if (
    url.origin !== STAGING_AUTH ||
    url.pathname !== '/auth/v1/verify' ||
    url.hash ||
    url.username ||
    url.password ||
    url.searchParams.get('type') !== 'signup' ||
    !/^[A-Za-z0-9._~-]{12,1024}$/u.test(token || '') ||
    url.searchParams.get('redirect_to') !== redirect ||
    [...url.searchParams.keys()].some(
      (key) => !['type', 'token', 'redirect_to'].includes(key)
    )
  ) {
    deny();
  }
  // Only the calling browser navigates here. Never print or persist the URL.
  return url.href;
}

function linksFromEmail(mail) {
  const html = typeof mail?.html === 'string' ? mail.html : '';
  const plain = typeof mail?.text === 'string' ? mail.text : '';
  if (html.length > 100_000 || plain.length > 100_000) deny();
  const links = [
    ...[...html.matchAll(/\bhref\s*=\s*["']([^"']{20,4096})["']/giu)].map(
      (match) => match[1]
    ),
    ...[...plain.matchAll(/https:\/\/[^\s<>"']{20,4096}/giu)].map(
      (match) => match[0]
    )
  ];
  return links.map((value) =>
    value.replace(/&amp;|&#38;|&#x26;/giu, '&')
  );
}

export function parseReaderConfirmation(mail, recipient, sender, previewOrigin) {
  if (
    !Array.isArray(mail?.to) ||
    mail.to.length !== 1 ||
    mail.to[0]?.toLowerCase() !== recipient.toLowerCase() ||
    canonicalSender(mail.from) !== sender ||
    mail.subject !== SUBJECT
  ) {
    deny();
  }
  const matched = [];
  for (const value of linksFromEmail(mail)) {
    try {
      matched.push(requireSignupVerificationLink(value, previewOrigin));
    } catch {
      // Ignore other links. Untrusted email is never allowed to select a host.
    }
  }
  const unique = [...new Set(matched)];
  if (unique.length !== 1) deny();
  return unique[0];
}

export async function receiveReaderConfirmation({
  mailbox,
  recipient,
  previewOrigin,
  sinceMs,
  fetcher = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxPolls = 12
}) {
  if (
    !recipient?.endsWith('@' + mailbox?.domain) ||
    !Number.isFinite(sinceMs) ||
    maxPolls < 1 ||
    maxPolls > 12
  ) {
    deny();
  }
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const list = await inboundGet('?limit=30', mailbox.apiKey, fetcher);
    if (list?.object !== 'list' || !Array.isArray(list.data)) deny();
    const matched = list.data.filter((mail) => {
      const time = Date.parse(mail.created_at || '');
      return (
        UUID.test(mail.id || '') &&
        Array.isArray(mail.to) &&
        mail.to.length === 1 &&
        mail.to[0]?.toLowerCase() === recipient.toLowerCase() &&
        canonicalSender(mail.from) === mailbox.sender &&
        mail.subject === SUBJECT &&
        Number.isFinite(time) &&
        time >= sinceMs - 10_000 &&
        time <= Date.now() + 30_000
      );
    });
    if (matched.length > 1) deny();
    if (matched.length === 1) {
      const msg = await inboundGet(
        '/' + matched[0].id,
        mailbox.apiKey,
        fetcher
      );
      return parseReaderConfirmation(
        msg,
        recipient,
        mailbox.sender,
        previewOrigin
      );
    }
    if (attempt < maxPolls - 1) await sleep(5000);
  }
  deny();
}
