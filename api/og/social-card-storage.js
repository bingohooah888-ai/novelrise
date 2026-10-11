import { getSupabase } from '../seo/public-page.js';
import { safeOgImageUrl } from './novel-data.js';
import { renderNovelOgPng } from './novel.js';

const SOCIAL_CARD_BUCKET = 'novel-thumbnail-renders';
const MAX_CARD_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const inFlight = new Map();

export function socialCardObjectPath(data) {
  const id = String(data?.id ?? '');
  const version = String(data?.version ?? '');
  if (!/^\d+$/u.test(id) || !/^[0-9a-f]{16}$/u.test(version)) {
    throw new Error('Invalid published social card identifier');
  }
  return `social-cards/${id}/${version}.png`;
}

function isValidCardPng(bytes) {
  if (!Buffer.isBuffer(bytes)) return false;
  return (
    bytes.length >= 24 &&
    bytes.length <= MAX_CARD_BYTES &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
    bytes.readUInt32BE(16) === 1200 &&
    bytes.readUInt32BE(20) === 630
  );
}

async function ensureCardFile(data, { client, render }) {
  const objectPath = socialCardObjectPath(data);
  const parent = objectPath.slice(0, objectPath.lastIndexOf('/'));
  const filename = objectPath.slice(objectPath.lastIndexOf('/') + 1);
  const bucket = client.storage.from(SOCIAL_CARD_BUCKET);

  // Existing cards are public, immutable objects. A new title/cover/version
  // creates a new path; no production DB migration is required.
  const { data: existing, error: lookupError } = await bucket.list(parent, {
    limit: 1,
    search: filename
  });
  if (lookupError) throw lookupError;

  if (!(existing ?? []).some((entry) => entry.name === filename)) {
    const png = await render(data);
    if (!isValidCardPng(png)) {
      throw new Error('Social card renderer returned an invalid 1200x630 PNG');
    }

    const { error: uploadError } = await bucket.upload(objectPath, png, {
      contentType: 'image/png',
      cacheControl: '31536000',
      upsert: false
    });
    // Concurrent requests may render the same version on different instances.
    if (uploadError && Number(uploadError.statusCode) !== 409) {
      throw uploadError;
    }
  }

  const { data: publicUrl } = bucket.getPublicUrl(objectPath);
  const imageUrl = safeOgImageUrl(publicUrl?.publicUrl);
  if (!imageUrl) throw new Error('Social card public URL is unavailable');
  return imageUrl;
}

export function ensureNovelSocialCard(
  data,
  { client = getSupabase(), render = renderNovelOgPng } = {}
) {
  const key = socialCardObjectPath(data);
  if (inFlight.has(key)) return inFlight.get(key);

  const task = ensureCardFile(data, { client, render }).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}
