import { requireAdmin } from './admin-auth.js';

const ANNOUNCEMENT_STATUSES = new Set(['draft', 'published', 'archived']);
const INQUIRY_STATUSES = new Set(['new', 'reviewing', 'resolved']);
const INQUIRY_PAGE_SIZES = new Set([20, 50]);
const ANNOUNCEMENT_COLUMNS =
  'id,title,body,category,status,published_at,created_at,updated_at';
const INQUIRY_SUMMARY_COLUMNS =
  'id,email,subject,user_id,status,category,created_at';
const INQUIRY_SUMMARY_COLUMNS_LEGACY =
  'id,email,subject,user_id,status,created_at';
const INQUIRY_DETAIL_COLUMNS =
  'id,email,subject,message,status,category,created_at,user_id';
const INQUIRY_DETAIL_COLUMNS_LEGACY =
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

function isMissingColumn(error, column) {
  if (!error) return false;
  const text = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
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

function parsePositiveInteger(value, fallback) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function normalizeSearchText(value, maxLength = 160) {
  return String(value ?? '')
    .trim()
    .replace(/[,%()]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function normalizeDate(value) {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function normalizeAnnouncementInput(body, { partial = false } = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  const title =
    payload.title === undefined ? undefined : String(payload.title).trim();
  const content =
    payload.body === undefined ? undefined : String(payload.body).trim();
  const category =
    payload.category === undefined
      ? undefined
      : String(payload.category).trim();
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
  return Array.isArray(data) ? (data[0] ?? null) : data;
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
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

async function findInquiryUserIds(supabase, term) {
  if (!term) return [];
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(term)) return [term];

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .ilike('display_name', `%${term}%`)
    .limit(50);
  if (error) return [];
  return (data ?? []).map((row) => row.id).filter(Boolean);
}

function applyInquiryFilters(query, options, profileIds, hasCategory) {
  const status = String(options.status ?? '')
    .trim()
    .toLowerCase();
  const category = normalizeSearchText(options.category, 40);
  const from = normalizeDate(options.from);
  const to = normalizeDate(options.to);
  const search = normalizeSearchText(options.q);
  const user = normalizeSearchText(options.user);

  if (INQUIRY_STATUSES.has(status)) query = query.eq('status', status);
  if (hasCategory && category) query = query.eq('category', category);
  if (from) query = query.gte('created_at', `${from}T00:00:00+09:00`);
  if (to) query = query.lt('created_at', `${to}T23:59:59.999+09:00`);

  if (user) {
    const userClauses = [`email.ilike.%${user}%`];
    if (profileIds.length)
      userClauses.push(`user_id.in.(${profileIds.join(',')})`);
    query = query.or(userClauses.join(','));
  }

  if (search) {
    query = query.or(
      `subject.ilike.%${search}%,email.ilike.%${search}%,message.ilike.%${search}%`
    );
  }
  return query;
}

export async function loadInquirySummaries(supabase, options = {}) {
  const page = parsePositiveInteger(options.page, 1);
  const requestedPageSize = parsePositiveInteger(options.pageSize, 20);
  const pageSize = INQUIRY_PAGE_SIZES.has(requestedPageSize)
    ? requestedPageSize
    : 20;
  const offset = (page - 1) * pageSize;
  const userTerm = normalizeSearchText(options.user);
  const profileIds = await findInquiryUserIds(supabase, userTerm);

  async function run(hasCategory) {
    let query = supabase
      .from('contact_inquiries')
      .select(
        hasCategory ? INQUIRY_SUMMARY_COLUMNS : INQUIRY_SUMMARY_COLUMNS_LEGACY,
        { count: 'exact' }
      );
    query = applyInquiryFilters(query, options, profileIds, hasCategory)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    return query;
  }

  let result = await run(true);
  let hasCategory = true;
  if (result.error && isMissingColumn(result.error, 'category')) {
    hasCategory = false;
    result = await run(false);
  }
  if (result.error) throw result.error;

  const items = (result.data ?? []).map((row) => ({
    ...row,
    category: row.category ?? 'general'
  }));
  const total = Number(result.count ?? 0);
  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    hasCategory
  };
}

export async function loadInquiryDetail(supabase, id) {
  let result = await supabase
    .from('contact_inquiries')
    .select(INQUIRY_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (result.error && isMissingColumn(result.error, 'category')) {
    result = await supabase
      .from('contact_inquiries')
      .select(INQUIRY_DETAIL_COLUMNS_LEGACY)
      .eq('id', id)
      .maybeSingle();
  }
  if (result.error) throw result.error;
  return result.data
    ? { ...result.data, category: result.data.category ?? 'general' }
    : null;
}

export async function updateInquiryStatus(supabase, adminUserId, id, status) {
  const normalized = String(status ?? '')
    .trim()
    .toLowerCase();
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
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

function handleAdminError(res, error, fallback) {
  if (error?.code === 'INVALID_INPUT') {
    return res.status(400).json({ error: 'Invalid request' });
  }
  if (
    error?.code === 'SCHEMA_NOT_READY' ||
    isMissingRelation(error, 'announcements')
  ) {
    return res
      .status(503)
      .json({ error: 'Announcements are not available yet' });
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

        const result = await listInquiries(supabase, req.query ?? {});
        if (Array.isArray(result)) {
          return res.status(200).json({ inquiries: result });
        }
        return res.status(200).json({
          inquiries: result.items,
          pagination: {
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            pageCount: result.pageCount
          },
          capabilities: { category: result.hasCategory !== false }
        });
      }

      const id = parsePositiveId(req.body?.id);
      if (!id) return res.status(400).json({ error: 'Invalid request' });
      const inquiry = await setStatus(supabase, admin.id, id, req.body?.status);
      return res.status(200).json({ inquiry });
    } catch (error) {
      return handleAdminError(res, error, 'NOVELIGHT inquiry operation failed');
    }
  };
}
