import { createClient } from '@supabase/supabase-js';

const SITE_ORIGIN = 'https://novelight.jp';
const PAGE_SIZE = 1000;
const SITEMAP_CACHE = 'public, s-maxage=900, stale-while-revalidate=86400';

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

export function createSitemapHandler({ supabase }) {
  return async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return res.status(405).end();
    }

    try {
      const novels = await fetchRows(supabase, 'novels', 'id,user_id');
      const episodes = await fetchRows(supabase, 'episodes', 'id,novel_id');

      const publishedNovelIds = new Set();
      const authorIds = new Set();
      for (const novel of novels) {
        publishedNovelIds.add(String(novel.id));
        if (novel.user_id) {
          authorIds.add(String(novel.user_id));
        }
      }

      const paths = [
        '/',
        '/search.html',
        '/ranking.html',
        '/pricing.html',
        '/beta-authors',
        '/operator.html'
      ];

      for (const novel of novels) {
        paths.push(queryPath('novel', novel.id));
      }

      for (const episode of episodes) {
        const novelId = String(episode.novel_id);
        if (!publishedNovelIds.has(novelId)) {
          continue;
        }
        paths.push(queryPath('episode', episode.id));
      }

      for (const authorId of authorIds) {
        paths.push(queryPath('author', authorId));
      }

      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...paths.map(urlEntry),
        '</urlset>',
        ''
      ].join('\n');

      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', SITEMAP_CACHE);
      return res.status(200).send(req.method === 'HEAD' ? '' : xml);
    } catch (error) {
      console.error('Sitemap generation failed', {
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
