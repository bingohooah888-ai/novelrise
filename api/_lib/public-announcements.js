function isMissingAnnouncementsRelation(error) {
  if (!error) return false;
  const text = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    (text.includes('announcements') &&
      (text.includes('does not exist') || text.includes('schema cache')))
  );
}

export async function loadPublishedAnnouncements(
  supabase,
  now = new Date()
) {
  const { data, error } = await supabase
    .from('announcements')
    .select('id,title,body,category,published_at')
    .eq('status', 'published')
    .lte('published_at', now.toISOString())
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(50);

  if (error) {
    if (isMissingAnnouncementsRelation(error)) return [];
    throw error;
  }
  return data ?? [];
}

export function createPublishedAnnouncementsHandler({
  supabase,
  loadAnnouncements = loadPublishedAnnouncements,
  clock = () => new Date()
}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const announcements = await loadAnnouncements(supabase, clock());
      return res.status(200).json({ announcements });
    } catch (error) {
      console.error('NOVELIGHT public announcements request failed', {
        message: error?.message ?? 'unknown error'
      });
      return res.status(500).json({ error: 'Announcements unavailable' });
    }
  };
}
