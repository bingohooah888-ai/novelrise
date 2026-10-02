import { createClient } from '@supabase/supabase-js';

const SITE_ORIGIN = 'https://novelight.jp';
const PAGE_SIZE = 1000;
const SITEMAP_CACHE = 'public, s-maxage=900, stale-while-revalidate=86400';
const VALID_TYPES = new Set(['core', 'novels', 'episodes', 'authors']);
const CORE_PATHS = [
  '/',
  '/search.html',
  '/ranking.html',
  '/pricing.html',
  '/beta-authors'
];

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function queryPath(page, id) {
  const encodedId = encodeURIComponent(id);
  return `/${page}.html?id=${encodedId}`;
}

function urlEntry(path) {
  return `  <url><loc>${xmlEscape(`${SITE_ORIGIN}${path}`)}</loc></url>`;
}

export function buildSitemapDocument(paths) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map(urlEntry),
    '</urlset>',
    ''
  ].join('\n');
}

async function fetchRows(supabase, table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('status', 'published')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function pathsForType(supabase, type) {
  if (type === 'core') return CORE_PATHS;

  if (type === 'novels') {
    const novels = await fetchRows(supabase, 'novels', 'id');
    return novels.map((novel) => queryPath('novel', novel.id));
  }

  const novels = await fetchRows(supabase, 'novels', 'id,user_id');

  if (type === 'authors') {
    const authorIds = new Set();
    for (const novel of novels) {
      if (novel.user_id) authorIds.add(String(novel.user_id));
    }
    return [...authorIds].map((authorId) => queryPath('author', authorId));
  }

  const publishedNovelIds = new Set(novels.map((novel) => String(novel.id)));
  const episodes = await fetchRows(supabase, 'episodes', 'id,novel_id');
  return episodes
    .filter((episode) => publishedNovelIds.has(String(episode.novel_id)))
    .map((episode) => queryPath('episode', episode.id));
}

export function createSitemapHandler({ supabase }) {
  return async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return res.status(405).end();
    }

    const type = String(req.query?.type || 'core').toLowerCase();
    if (!VALID_TYPES.has(type)) {
      return res.status(400).send('Unknown sitemap type');
    }

    try {
      const paths = await pathsForType(supabase, type);
      const xml = buildSitemapDocument(paths);

      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', SITEMAP_CACHE);
      return res.status(200).send(req.method === 'HEAD' ? '' : xml);
    } catch (error) {
      console.error('Sitemap generation failed', {
        type,
        code: error?.code || null,
        message: error?.message || null
      });
      return res.status(503).send('Sitemap temporarily unavailable');
    }
  };
}

let productionHandler;

export default function handler(req, res) {
  if (!productionHandler) {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
    productionHandler = createSitemapHandler({ supabase });
  }

  return productionHandler(req, res);
}
