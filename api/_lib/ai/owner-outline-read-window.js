// AI phase 2: offline-only contract for a future private outline reader.
// NOT mounted as a route, imported by the deployed preview, or an auth check.
// Its access observations MUST originate from server-verified Supabase Auth
// and a separately owner-checked novels row; never from browser request data.
// Do not pass a JWT, service-role key, or raw token to this helper.
// This detects concurrent outline changes within the observation window,
// NOT changes after its final snapshot (no DB revision/CAS exists here).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positive(value) {
  const n = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^[1-9]\\d*$/.test(value)
      ? Number(value)
      : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function trustedObservation(item, novelId) {
  // Labels describe the provenance required of a FUTURE caller; the helper
  // cannot independently verify them and must never be used to grant access.
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const actor = item.verifiedActorId;
  const owner = item.checkedNovelOwnerId;
  const binding = item.sessionBinding;
  if (
    typeof actor !== 'string' || !UUID.test(actor) ||
    typeof owner !== 'string' || !UUID.test(owner) ||
    actor.toLowerCase() !== owner.toLowerCase() ||
    positive(item.checkedNovelId) !== novelId ||
    typeof binding !== 'string' || binding.length < 1 || binding.length > 128
  ) return null;
  return { actor: actor.toLowerCase(), binding };
}

function normalizedSnapshot(rows) {
  if (!Array.isArray(rows) || rows.length > 10000) return null;
  const seenEpisodes = new Set();
  const seenNumbers = new Set();
  const chapters = new Map();
  const positions = new Map();
  const normalized = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const episodeId = positive(row.episode_id);
    const episodeNumber = positive(row.episode_number);
    if (
      !episodeId || !episodeNumber ||
      seenEpisodes.has(episodeId) || seenNumbers.has(episodeNumber) ||
      typeof row.episode_title !== 'string' || row.episode_title.length > 8192 ||
      !['draft', 'published'].includes(row.episode_status)
    ) return null;
    seenEpisodes.add(episodeId);
    seenNumbers.add(episodeNumber);

    const noChapter = row.chapter_id === null;
    let chapterId = null;
    let chapterPosition = null;
    let chapterTitle = null;
    if (noChapter) {
      if (row.chapter_title !== null || row.chapter_position !== null) return null;
    } else {
      chapterId = positive(row.chapter_id);
      chapterPosition = positive(row.chapter_position);
      chapterTitle = row.chapter_title;
      if (!chapterId || !chapterPosition ||
          typeof chapterTitle !== 'string' ||
          !chapterTitle.trim() || chapterTitle.length > 120) return null;
      const existing = chapters.get(chapterId);
      if (existing &&
          (existing.position !== chapterPosition || existing.title !== chapterTitle)) return null;
      const existingAtPosition = positions.get(chapterPosition);
      if (existingAtPosition !== undefined && existingAtPosition !== chapterId) return null;
      chapters.set(chapterId, { position: chapterPosition, title: chapterTitle });
      positions.set(chapterPosition, chapterId);
    }
    normalized.push({
      episode_id: episodeId,
      episode_number: episodeNumber,
      episode_title: row.episode_title,
      episode_status: row.episode_status,
      chapter_id: chapterId,
      chapter_title: chapterTitle,
      chapter_position: chapterPosition
    });
  }
  normalized.sort((a, b) => a.episode_id - b.episode_id);
  return normalized;
}

export function validateOwnerOutlineReadWindow({
  expectedNovelId,
  preview,
  accessBefore,
  accessAfter,
  outlineBefore,
  outlineAfter
} = {}) {
  const novelId = positive(expectedNovelId);
  if (
    !novelId ||
    !preview || typeof preview !== 'object' || Array.isArray(preview) ||
    preview.novelId !== novelId || preview.aiGenerated !== false ||
    Object.hasOwn(preview, 'candidates') ||
    !Array.isArray(preview.characters) ||
    !Array.isArray(preview.notes) ||
    !Array.isArray(preview.facts)
  ) return null;

  const start = trustedObservation(accessBefore, novelId);
  const end = trustedObservation(accessAfter, novelId);
  if (!start || !end ||
      start.actor !== end.actor || start.binding !== end.binding) return null;

  // Compare full navigation metadata, publication state and titles; a chapter
  // move, reorder, draft publication, rename or added/deleted episode fails.
  // Sorting by stable ID prevents false negatives from RPC row ordering.
  const before = normalizedSnapshot(outlineBefore);
  const after = normalizedSnapshot(outlineAfter);
  if (!before || !after || JSON.stringify(before) !== JSON.stringify(after)) {
    return null;
  }

  // Restrict the output to navigation fields. Episode titles/publication state
  // are compared for freshness but are NOT returned to the future UI joiner.
  const outlineRows = after.map((row) => Object.freeze({
    episode_id: row.episode_id,
    episode_number: row.episode_number,
    chapter_id: row.chapter_id,
    chapter_title: row.chapter_title,
    chapter_position: row.chapter_position
  }));
  return Object.freeze({ novelId, outlineRows: Object.freeze(outlineRows) });
}
