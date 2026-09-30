import { readFile } from 'node:fs/promises';

import { createClient } from '@supabase/supabase-js';

export const SITE_ORIGIN = 'https://novelight.jp';

let productionClient;

export function getSupabase() {
  if (!productionClient) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      throw new Error('Supabase server environment is unavailable');
    }

    productionClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
  }

  return productionClient;
}

export function queryValue(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string') return '';
  return candidate.trim().slice(0, 256);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function compactText(value, limit = 160) {
  const compact = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(compact).slice(0, limit).join('');
}

export async function readTemplate(templateUrl) {
  return readFile(templateUrl, 'utf8');
}

export function canonicalUrl(page, id) {
  return `${SITE_ORIGIN}/${page}.html?id=${encodeURIComponent(id)}`;
}

export function injectSeo(
  html,
  { title, description, canonical, indexable = true }
) {
  const safeTitle = escapeHtml(title);
  const tags = [
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<link rel="canonical" href="${escapeHtml(canonical)}">`
  ];

  if (!indexable) {
    tags.push('<meta name="robots" content="noindex, nofollow">');
  }

  const withTitle = html.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${safeTitle}</title>`
  );
  return withTitle.replace('</head>', `${tags.join('\n')}\n</head>`);
}

export function replacePlaceholder(html, placeholder, replacement) {
  return html.includes(placeholder)
    ? html.replace(placeholder, replacement)
    : html;
}

export function sendHtml(req, res, html, { indexable = true } = {}) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (!indexable) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  return res.status(200).send(req.method === 'HEAD' ? '' : html);
}

export function methodAllowed(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  res.setHeader('Allow', 'GET, HEAD');
  res.status(405).end();
  return false;
}
