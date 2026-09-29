import { createClient } from '@supabase/supabase-js';

const SITE_ORIGIN = 'https://novelight.jp';
const PAGE_SIZE = 1000;

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function urlEntry(path) {
  return `  <url><loc>${xmlEscape(`${SITE_ORIGIN}${path}`)}</loc></url>`;
}

async function fetchPublishedRows(supabase, table, columns) {
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
      const [novels, episodes] = await Promise.all([
        fetchPublishedRows(supabase, 'novels', 'id,user_id'),
        fetchPublishedRows(supabase, 'episodes', 'id,novel_id')
      ]);

      const publishedNovelIds = new Set(novels.map((novel) => String(novel.id)));
      const authorIds = [
        ...new Set(novels.map((novel) => novel.user_id).filter(Boolean).map(String))
      ];

      const paths = [
        '/',
        '/search.html',
        '/ranking.html',
        '/pricing.html',
        '/beta-authors',
        '/operator.html',
        ...novels.map((novel) => `/novel.html?id=${encodeURIComponent(novel.id)}`),
        ...episodes
          .filter((episode) => publishedNovelIds.has(String(episode.novel_id)))
          .map((episode) => `/episode.html?id=${encodeURIComponent(episode.id)}`),
        ...authorIds.map((authorId) => `/author.html?id=${encodeURIComponent(authorId)}`)
      ];

      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...paths.map(urlEntry),
        '</urlset>',
        ''
      ].join('\n');

      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
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
