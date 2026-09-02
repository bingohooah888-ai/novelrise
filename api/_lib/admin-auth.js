import { URL } from 'node:url';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AdminConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminConfigurationError';
  }
}

function getBearerToken(authorization) {
  const match =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;

  return match?.[1] ?? null;
}

function csvValues(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseAdminAllowlist(env = process.env) {
  const userIds = csvValues(env.NOVELIGHT_ADMIN_USER_IDS);
  const emails = csvValues(env.NOVELIGHT_ADMIN_EMAILS).map((email) =>
    email.toLowerCase()
  );

  if (userIds.some((id) => !UUID_PATTERN.test(id))) {
    throw new AdminConfigurationError('Admin user ID allowlist is malformed');
  }

  if (emails.some((email) => !EMAIL_PATTERN.test(email))) {
    throw new AdminConfigurationError('Admin email allowlist is malformed');
  }

  if (!userIds.length && !emails.length) {
    throw new AdminConfigurationError('Admin allowlist is not configured');
  }

  return {
    userIds: new Set(userIds.map((id) => id.toLowerCase())),
    emails: new Set(emails)
  };
}

function isAllowedAdmin(user, allowlist) {
  const id = typeof user?.id === 'string' ? user.id.toLowerCase() : '';
  const email =
    typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';

  return allowlist.userIds.has(id) || (email && allowlist.emails.has(email));
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) return value[0] ?? '';
  return String(value ?? '')
    .split(',')[0]
    .trim();
}

export function isSameOriginRequest(req) {
  const fetchSite = firstHeaderValue(req.headers?.['sec-fetch-site']);
  if (fetchSite === 'cross-site') return false;

  const origin = firstHeaderValue(req.headers?.origin);
  if (!origin) return true;

  const host = firstHeaderValue(
    req.headers?.['x-forwarded-host'] ?? req.headers?.host
  );
  if (!host) return false;

  const protocol =
    firstHeaderValue(req.headers?.['x-forwarded-proto']) || 'https';

  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

export function applyAdminSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

export async function requireAdmin({ req, res, supabase, env = process.env }) {
  applyAdminSecurityHeaders(res);

  if (!isSameOriginRequest(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  const token = getBearerToken(req.headers?.authorization);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  let allowlist;
  try {
    allowlist = parseAdminAllowlist(env);
  } catch (error) {
    if (error instanceof AdminConfigurationError) {
      console.error('NOVELIGHT admin allowlist configuration is invalid');
      res.status(503).json({ error: 'Admin access is not configured' });
      return null;
    }
    throw error;
  }

  const { data, error: authError } = await supabase.auth.getUser(token);
  const user = data?.user;

  if (authError || !user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  if (!isAllowedAdmin(user, allowlist)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return user;
}
