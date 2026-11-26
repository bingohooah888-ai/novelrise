// Offline projection for the existing novelight_novel_outline RPC contract.
// IMPORTANT: this does not query the RPC, grant permission, or mount a UI.
// Only a future server-authorized owner-preview may supply private outline rows.
// Episode IDs are identifiers; episode_number is an authoritative navigation
// ordinal, NEVER a claim about fictional time or chronology within the story.
(function (root) {
  'use strict';

  function positive(value) {
    const raw =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && /^[1-9]\d*$/.test(value)
          ? Number(value)
          : NaN;
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }

  function chapter(row) {
    if (row.chapter_id === null) {
      if (row.chapter_title !== null || row.chapter_position !== null) {
        return null;
      }
      return { id: null, title: null, position: null };
    }
    const id = positive(row.chapter_id);
    const position = positive(row.chapter_position);
    const title = row.chapter_title;
    if (
      !id ||
      !position ||
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 120
    )
      return null;
    return { id, title, position };
  }

  function project({ expectedNovelId, preview, outlineRows, story } = {}) {
    const novelId = positive(expectedNovelId);
    if (
      !novelId ||
      !preview ||
      typeof preview !== 'object' ||
      preview.novelId !== novelId ||
      preview.aiGenerated !== false ||
      !Array.isArray(outlineRows) ||
      outlineRows.length > 10000 ||
      !story ||
      !Array.isArray(story.foreshadowing) ||
      !Array.isArray(story.events)
    )
      return null;

    const byEpisode = new Map();
    const orderNumbers = new Set();
    const chapters = new Map();

    for (const row of outlineRows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
      const id = positive(row.episode_id);
      const number = positive(row.episode_number);
      const metadata = chapter(row);
      if (
        !id ||
        !number ||
        !metadata ||
        byEpisode.has(id) ||
        orderNumbers.has(number)
      )
        return null;
      if (metadata.id !== null) {
        const known = chapters.get(metadata.id);
        if (
          known &&
          (known.title !== metadata.title ||
            known.position !== metadata.position)
        )
          return null;
        chapters.set(metadata.id, metadata);
      }
      orderNumbers.add(number);
      byEpisode.set(id, {
        episodeId: id,
        episodeNumber: number,
        chapterId: metadata.id,
        chapterTitle: metadata.title,
        chapterPosition: metadata.position
      });
    }

    function groups(rows) {
      if (rows.length > 200) return null;
      const projected = [];
      for (const item of rows) {
        if (
          !item ||
          typeof item.key !== 'string' ||
          item.key.length > 120 ||
          !Array.isArray(item.sourceEpisodeIds) ||
          item.sourceEpisodeIds.length > 200
        )
          return null;
        const seen = new Set();
        const references = [];
        for (const rawId of item.sourceEpisodeIds) {
          const id = positive(rawId);
          if (!id || seen.has(id) || !byEpisode.has(id)) return null;
          seen.add(id);
          references.push({ ...byEpisode.get(id) });
        }
        references.sort(
          (a, b) =>
            a.episodeNumber - b.episodeNumber || a.episodeId - b.episodeId
        );
        projected.push({
          kind: item.kind,
          key: item.key,
          references,
          // An unreferenced setting has no known chapter number.
          firstEpisodeNumber: references[0]?.episodeNumber ?? null
        });
      }
      return projected.sort(
        (a, b) =>
          (a.firstEpisodeNumber ?? Infinity) -
            (b.firstEpisodeNumber ?? Infinity) ||
          a.key.localeCompare(b.key, 'ja-JP')
      );
    }

    const foreshadowing = groups(story.foreshadowing);
    const events = groups(story.events);
    return foreshadowing && events ? { foreshadowing, events } : null;
  }

  root.NovelightAiBibleOwnerOutline = Object.freeze({ project });
})(globalThis);
