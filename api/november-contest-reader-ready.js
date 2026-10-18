import { getSupabase } from './seo/public-page.js';

// Public, read-only launch probe. No reader identity or session is created.
// Contest scoring stays behind the independent Production env + database gates.
const CONTEST_KEY = 'novelight-november-2026';

export function createContestReaderReadyHandler({
  getDatabase = getSupabase,
  env = process.env,
  now = () => Date.now()
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ enabled: false });
    }

    const episodeId = req.query?.episode_id;
    if (
      typeof episodeId !== 'string' ||
      !/^[1-9][0-9]{0,15}$/.test(episodeId) ||
      !Number.isSafeInteger(Number(episodeId))
    ) {
      return res.status(200).json({ enabled: false });
    }

    const secret = env.NOVELIGHT_CONTEST_GUEST_SIGNING_SECRET;
    const secretValid =
      typeof secret === 'string' &&
      Buffer.byteLength(secret, 'utf8') >= 32 &&
      secret !== env.SUPABASE_SECRET_KEY;
    if (env.NOVELIGHT_CONTEST_READING_ENABLED !== 'true' || !secretValid) {
      return res.status(200).json({ enabled: false });
    }

    try {
      const database = getDatabase();
      const { data, error } = await database
        .from('novelight_contests')
        .select('id,status,public_visible,starts_at,ends_at')
        .eq('contest_key', CONTEST_KEY)
        .maybeSingle();
      const time = now();
      const start = Date.parse(data?.starts_at);
      const end = Date.parse(data?.ends_at);
      const launchReady =
        !error &&
        data?.status === 'active' &&
        data.public_visible === true &&
        Number.isFinite(time) &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start <= time &&
        time < end;
      if (!launchReady) return res.status(200).json({ enabled: false });

      // Only published episodes belonging to an entered contest work are
      // eligible. Browsing unrelated novels must not create contest readers.
      const episode = await database
        .from('episodes')
        .select('novel_id,status')
        .eq('id', episodeId)
        .maybeSingle();
      if (episode.error || episode.data?.status !== 'published') {
        return res.status(200).json({ enabled: false });
      }
      const entry = await database
        .from('novelight_contest_entries')
        .select('id')
        .eq('contest_id', data.id)
        .eq('novel_id', episode.data.novel_id)
        .eq('status', 'entered')
        .maybeSingle();
      return res.status(200).json({
        enabled: !entry.error && Boolean(entry.data?.id)
      });
    } catch {
      // Never expose operational secrets, RPC errors, or reader identities.
      return res.status(200).json({ enabled: false });
    }
  };
}

export default createContestReaderReadyHandler();
