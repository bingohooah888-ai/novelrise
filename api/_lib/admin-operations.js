import { requireAdmin } from './admin-auth.js';

const ANNOUNCEMENT_STATUSES = new Set(['draft', 'published', 'archived']);
const INQUIRY_STATUSES = new Set(['new', 'reviewing', 'resolved']);
const ANNOUNCEMENT_COLUMNS =
  'id,title,body,category,status,published_at,created_at,updated_at';
const INQUIRY_SUMMARY_COLUMNS = 'id,subject,status,created_at';
const INQUIRY_DETAIL_COLUMNS =
  'id,email,subject,message,status,created_at,user_id';

function isMissingRelation(error, relation) {
  if (!error) return false;
  const text = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    (text.includes(relation.toLowerCase()) &&
      (text.includes('does not exist') || text.includes('schema cache')))
  );
}

function parsePositiveId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeAnnouncementInput(body, { partial = false } = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  const title =
    payload.title === undefined ? undefined : String(payload.title).trim();
  const content =
    payload.body === undefined ? undefined : String(payload.body).trim();
  const category =
    payload.category === undefined ? undefined : String(payload.category).trim();
  const status =
    payload.status === undefined
      ? undefined
      : String(payload.status).trim().toLowerCase();

  if (!partial || title !== undefined) {
    if (!title || title.length > 120) return null;
  }
  if (!partial || content !== undefined) {
    if (!content || content.length > 10000) return null;
  }
  if (!partial || category !== undefined) {
    if (!category || category.length > 40) return null;
  }
  if (status !== undefined && !ANNOUNCEMENT_STATUSES.has(status)) return null;

  return {
    ...(title !== undefined ? { title } : {}),
    ...(content !== undefined ? { body: content } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(status !== undefined ? { status } : {})
  };
}

export async function loadOperationsSummary(supabase) {
  async function count(table, configure) {
    let query = supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    query = configure(query);
    const { count: value, error } = await query;
    if (error) throw error;
    return Number(value ?? 0);
  }

  const [pendingReports, pendingInquiries, publishedAnnouncements] =
    await Promise.all([
      count('content_reports', (query) =>
        query.in('status', ['new', 'reviewing'])
      ),
      count('contact_inquiries', (query) =>
        query.in('status', ['new', 'reviewing'])
      ),
      count('announcements', (query) => query.eq('status', 'published')).catch(
        (error) => {
          if (isMissingRelation(error, 'announcements')) return 0;
          throw error;
        }
      )
    ]);

  return { pendingReports, pendingInquiries, publishedAnnouncements };
}

export async function loadAdminAnnouncements(supabase) {
  const { data, error } = await supabase
    .from('announcements')
    .select(ANNOUNCEMENT_COLUMNS)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) {
    if (isMissingRelation(error, 'announcements')) {
      const unavailable = new Error('Announcements schema is not available');
      unavailable.code = 'SCHEMA_NOT_READY';
      throw unavailable;
    }
    throw error;
  }
  return data ?? [];
}

export async function createAdminAnnouncement(supabase, adminUserId, input) {
  const normalized = normalizeAnnouncementInput(input);
  if (!normalized) {
    const error = new Error('Invalid announcement');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  const { data, error } = await supabase.rpc(
    'novelight_admin_create_announcement',
    {
      p_admin_user_id: adminUserId,
      p_title: normalized.title,
      p_body: normalized.body,
      p_category: normalized.category,
      p_status: normalized.status ?? 'draft'
    }
  );
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function updateAdminAnnouncement(
  supabase,
  adminUserId,
  id,
  input
) {
  const normalized = normalizeAnnouncementInput(input);
  if (!normalized) {
    const error = new Error('Invalid announcement');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  const { data, error } = await supabase.rpc(
    'novelight_admin_update_announcement',
    {
      p_admin_user_id: adminUserId,
      p_id: id,
      p_title: normalized.title,
      p_body: normalized.body,
      p_category: normalized.category,
      p_status: normalized.status ?? 'draft'
    }
  );
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function loadInquirySummaries(supabase) {
  const { data, error } = await supabase
    .from('contact_inquiries')
    .select(INQUIRY_SUMMARY_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function loadInquiryDetail(supabase, id) {
  const { data, error } = await supabase
    .from('contact_inquiries')
    .select(INQUIRY_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function updateInquiryStatus(supabase, adminUserId, id, status) {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (!INQUIRY_STATUSES.has(normalized)) {
    const error = new Error('Invalid inquiry status');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  const { data, error } = await supabase.rpc(
    'novelight_admin_update_contact_inquiry_status',
    {
      p_admin_user_id: adminUserId,
      p_id: id,
      p_status: normalized
    }
  );
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data;
}

function handleAdminError(res, error, fallback) {
  if (error?.code === 'INVALID_INPUT') {
    return res.status(400).json({ error: 'Invalid request' });
  }
  if (
    error?.code === 'SCHEMA_NOT_READY' ||
    isMissingRelation(error, 'announcements')
  ) {
    return res.status(503).json({ error: 'Announcements are not available yet' });
  }
  if (error?.code === 'P0002') {
    return res.status(404).json({ error: 'Not found' });
  }
  console.error(fallback, { message: error?.message ?? 'unknown error' });
  return res.status(500).json({ error: 'ADMIN operation unavailable' });
}

export function createOperationsSummaryHandler({
  supabase,
  env = process.env,
  loadSummary = loadOperationsSummary
}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const admin = await requireAdmin({ req, res, supabase, env });
    if (!admin) return;

    try {
      const operations = await loadSummary(supabase);
      return res.status(200).json({ operations });
    } catch (error) {
      return handleAdminError(
        res,
        error,
        'NOVELIGHT operations summary failed'
      );
    }
  };
}

export function createAdminAnnouncementsHandler({
  supabase,
  env = process.env,
  listAnnouncements = loadAdminAnnouncements,
  createAnnouncement = createAdminAnnouncement,
  updateAnnouncement = updateAdminAnnouncement
}) {
  return async function handler(req, res) {
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const admin = await requireAdmin({ req, res, supabase, env });
    if (!admin) return;

    try {
      if (req.method === 'GET') {
        return res
          .status(200)
          .json({ announcements: await listAnnouncements(supabase) });
      }

      if (req.method === 'POST') {
        const created = await createAnnouncement(supabase, admin.id, req.body);
        return res.status(201).json({ announcement: created });
      }

      const id = parsePositiveId(req.body?.id);
      if (!id) return res.status(400).json({ error: 'Invalid request' });
      const updated = await updateAnnouncement(
        supabase,
        admin.id,
        id,
        req.body
      );
      return res.status(200).json({ announcement: updated });
    } catch (error) {
      return handleAdminError(
        res,
        error,
        'NOVELIGHT announcement operation failed'
      );
    }
  };
}

export function createAdminInquiriesHandler({
  supabase,
  env = process.env,
  listInquiries = loadInquirySummaries,
  getInquiry = loadInquiryDetail,
  setStatus = updateInquiryStatus
}) {
  return async function handler(req, res) {
    if (!['GET', 'PATCH'].includes(req.method)) {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const admin = await requireAdmin({ req, res, supabase, env });
    if (!admin) return;

    try {
      if (req.method === 'GET') {
        if (req.query?.id !== undefined) {
          const id = parsePositiveId(req.query.id);
          if (!id) return res.status(400).json({ error: 'Invalid request' });
          const inquiry = await getInquiry(supabase, id);
          if (!inquiry) return res.status(404).json({ error: 'Not found' });
          return res.status(200).json({ inquiry });
        }

        return res
          .status(200)
          .json({ inquiries: await listInquiries(supabase) });
      }

      const id = parsePositiveId(req.body?.id);
      if (!id) return res.status(400).json({ error: 'Invalid request' });
      const inquiry = await setStatus(
        supabase,
        admin.id,
        id,
        req.body?.status
      );
      return res.status(200).json({ inquiry });
    } catch (error) {
      return handleAdminError(res, error, 'NOVELIGHT inquiry operation failed');
    }
  };
}
