import { randomUUID } from 'node:crypto';

import { requireAdmin } from './admin-auth.js';

export const ANNOUNCEMENT_IMAGE_BUCKET = 'announcement-images';
export const ANNOUNCEMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);
const PATH_PATTERN =
  /^images\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:webp|png|jpg|jpeg)$/i;

function normalizePositiveSize(value) {
  const size = Number(value);
  return Number.isSafeInteger(size) && size > 0 ? size : null;
}

export function normalizeAnnouncementImagePath(value) {
  const path = String(value ?? '').trim();
  return PATH_PATTERN.test(path) ? path : null;
}

export function createAdminAnnouncementImagesHandler({
  supabase,
  env = process.env,
  uuid = randomUUID
}) {
  return async function handler(req, res) {
    if (!['POST', 'DELETE'].includes(req.method)) {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const admin = await requireAdmin({ req, res, supabase, env });
    if (!admin) return;

    try {
      if (req.method === 'POST') {
        const contentType = String(req.body?.contentType ?? '')
          .trim()
          .toLowerCase();
        const extension = MIME_EXTENSIONS.get(contentType);
        const fileSize = normalizePositiveSize(req.body?.fileSize);

        if (
          !extension ||
          !fileSize ||
          fileSize > ANNOUNCEMENT_IMAGE_MAX_BYTES
        ) {
          return res.status(400).json({ error: 'Invalid announcement image' });
        }

        const path = `images/${uuid()}.${extension}`;
        const { data, error } = await supabase.storage
          .from(ANNOUNCEMENT_IMAGE_BUCKET)
          .createSignedUploadUrl(path, { upsert: false });

        if (error || !data?.token) {
          if (
            error?.statusCode === 404 ||
            String(error?.message ?? '')
              .toLowerCase()
              .includes('bucket')
          ) {
            return res.status(503).json({
              error: 'Announcement image storage is not available yet'
            });
          }
          throw error ?? new Error('Signed upload token was not returned');
        }

        return res.status(201).json({
          upload: {
            bucket: ANNOUNCEMENT_IMAGE_BUCKET,
            path,
            token: data.token
          }
        });
      }

      const path = normalizeAnnouncementImagePath(req.body?.path);
      if (!path) {
        return res
          .status(400)
          .json({ error: 'Invalid announcement image path' });
      }

      const { error } = await supabase.storage
        .from(ANNOUNCEMENT_IMAGE_BUCKET)
        .remove([path]);
      if (error) throw error;

      return res.status(200).json({ removed: true });
    } catch (error) {
      console.error('NOVELIGHT announcement image operation failed', {
        message: error?.message ?? 'unknown error'
      });
      return res
        .status(500)
        .json({ error: 'Announcement image operation failed' });
    }
  };
}
