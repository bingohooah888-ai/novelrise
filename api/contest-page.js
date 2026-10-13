import { contestPageTemplate } from './_lib/contest-template.js';
import { getSupabase, methodAllowed, sendHtml } from './seo/public-page.js';

const KEY = 'novelight-november-2026';

export function isContestVisible(record) {
  return (
    record?.public_visible === true &&
    ['registration', 'active', 'review', 'finalized'].includes(record.status)
  );
}

function notFound(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(404).send('Not Found');
}

export function createContestPageHandler(getDatabase = getSupabase) {
  return async function handler(req, res) {
    if (!methodAllowed(req, res)) return;

  try {
    const { data, error } = await getDatabase()
      .from('novelight_contests')
      .select('public_visible,status')
      .eq('contest_key', KEY)
      .maybeSingle();

    if (error || !isContestVisible(data)) return notFound(res);
    return sendHtml(req, res, contestPageTemplate);
    } catch {
      return notFound(res);
    }
  };
}

export default createContestPageHandler();
