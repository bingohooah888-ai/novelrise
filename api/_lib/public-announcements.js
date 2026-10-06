const DETAIL_COLUMNS =
  'id,title,body,category,image_path,published_at';
const DETAIL_COLUMNS_LEGACY =
  'id,title,body,category,published_at';
const ANNOUNCEMENT_IMAGE_BUCKET = 'announcement-images';

function errorText(error) {
  return [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isMissingAnnouncementsRelation(error) {
  if (!error) return false;
  const text = errorText(error);
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    (text.includes('announcements') &&
      (text.includes('does not exist') || text.includes('schema cache')))
  );
}

function isMissingColumn(error, column) {
  if (!error) return false;
  const text = errorText(error);
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    (text.includes(column.toLowerCase()) &&
      (text.includes('column') || text.includes('schema cache')))
  );
}

function parsePositiveId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function loadPublishedAnnouncements(supabase, now = new Date()) {
  const { data, error } = await supabase
    .from('announcements')
    .select('id,title,category,published_at')
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

export async function loadPublishedAnnouncement(
  supabase,
  id,
  now = new Date()
) {
  let result = await supabase
    .from('announcements')
    .select(DETAIL_COLUMNS)
    .eq('id', id)
    .eq('status', 'published')
    .lte('published_at', now.toISOString())
    .maybeSingle();

  if (result.error && isMissingColumn(result.error, 'image_path')) {
    result = await supabase
      .from('announcements')
      .select(DETAIL_COLUMNS_LEGACY)
      .eq('id', id)
      .eq('status', 'published')
      .lte('published_at', now.toISOString())
      .maybeSingle();
  }

  if (result.error) {
    if (isMissingAnnouncementsRelation(result.error)) return null;
    throw result.error;
  }

  if (!result.data) return null;
  const row = { ...result.data, image_path: result.data.image_path ?? null };

  if (!row.image_path) {
    return { ...row, image_url: null, image_path: undefined };
  }

  const publicUrl = supabase.storage
    .from(ANNOUNCEMENT_IMAGE_BUCKET)
    .getPublicUrl(row.image_path)?.data?.publicUrl;

  return {
    ...row,
    image_url: typeof publicUrl === 'string' && publicUrl ? publicUrl : null,
    image_path: undefined
  };
}

export function createPublishedAnnouncementsHandler({
  supabase,
  loadAnnouncements = loadPublishedAnnouncements,
  loadAnnouncement = loadPublishedAnnouncement,
  clock = () => new Date()
}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      if (req.query?.id !== undefined) {
        const id = parsePositiveId(req.query.id);
        if (!id) return res.status(400).json({ error: 'Invalid request' });

        const announcement = await loadAnnouncement(supabase, id, clock());
        if (!announcement) {
          return res.status(404).json({ error: 'Announcement not found' });
        }
        return res.status(200).json({ announcement });
      }

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
