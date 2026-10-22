import {
  CONTEST_TERMS_URL_CANDIDATE,
  CONTEST_TERMS_VERSION_CANDIDATE,
  contestTermsTemplate
} from './_lib/contest-terms-template.js';
import { getSupabase, methodAllowed, sendHtml } from './seo/public-page.js';
import { LEGACY_CONTEST_TERMS_VERSION, legacyContestTermsTemplate } from './_lib/contest-terms-november-v1.js';

const KEY = 'novelight-november-2026';

export function isContestTermsVisible(record) {
  return (
    record?.public_visible === true &&
    ['registration', 'active', 'review', 'finalized'].includes(record.status) &&
    [CONTEST_TERMS_VERSION_CANDIDATE, LEGACY_CONTEST_TERMS_VERSION].includes(record.terms_version) &&
    record.terms_url === CONTEST_TERMS_URL_CANDIDATE
  );
}

function notFound(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(404).send('Not Found');
}

export function createContestTermsHandler(getDatabase = getSupabase) {
  return async function handler(req, res) {
    if (!methodAllowed(req, res)) return;
    try {
      const { data, error } = await getDatabase()
        .from('novelight_contests')
        .select('status,public_visible,terms_version,terms_url')
        .eq('contest_key', KEY)
        .maybeSingle();
      if (error || !isContestTermsVisible(data)) return notFound(res);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('CDN-Cache-Control', 'no-store');
      res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
      return sendHtml(req, res, data.terms_version === LEGACY_CONTEST_TERMS_VERSION
        ? legacyContestTermsTemplate : contestTermsTemplate);
    } catch {
      return notFound(res);
    }
  };
}

export default createContestTermsHandler();
